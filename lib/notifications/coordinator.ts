/** Ordinary text notifications only. No CallKit, PushKit or SIP code. */
export interface NotificationIdentity { owner:object|null; tenantId:number|null; active:boolean; enabled:boolean; }
export type ChatNotificationEnableResult = {status:"enabled"|"permission-denied"|"unavailable"|"session-changed";retryable?:boolean};
export class ChatNotificationSetupError extends Error {
 constructor(readonly retryable:boolean){super("Notification setup unavailable");}
}
function retryableSetupError(error:unknown) {
 if(error instanceof ChatNotificationSetupError)return error.retryable;
 const code=(error as {data?:{code?:string}}|null)?.data?.code;
 return !code||!["UNAUTHORIZED","FORBIDDEN","BAD_REQUEST","NOT_FOUND","PRECONDITION_FAILED","METHOD_NOT_SUPPORTED","PARSE_ERROR","UNPROCESSABLE_CONTENT"].includes(code);
}
export interface NotificationDestination {tenantId:number;conversationId:string;}
export function createChatNotificationCoordinator(deps:{
 identity():NotificationIdentity;
 permission(request:boolean):Promise<boolean>;
 token():Promise<string>;
 register(token:string,tenantId:number,current:()=>boolean):Promise<boolean>;
 resolve(eventId:string,current:()=>boolean):Promise<NotificationDestination|null>;
 open(destination:NotificationDestination):void;
 unavailable?():void;
}) {
 let pendingPermission=false;
 let permissionTicket:object|null=null;
 let revision=0,stopped=false,pending:Promise<ChatNotificationEnableResult>|null=null;
 let queued:unknown=null,tapWork:Promise<void>|null=null;
 const seen=new Set<string>();
 const same=(origin:NotificationIdentity,at:number,requireActive=true)=>{
  const now=deps.identity();return !stopped&&at===revision&&origin.owner!==null&&origin.owner===now.owner&&origin.tenantId===now.tenantId&&(!requireActive||now.active)&&now.enabled;
 };
 const coordinator = {
  invalidate(discardTap=false,preservePermission=false){
   if(preservePermission&&permissionTicket)return;
   revision++;pending=null;tapWork=null;permissionTicket=null;if(discardTap)queued=null;
  },
  stop(){stopped=true;revision++;permissionTicket=null;pending=null;tapWork=null;queued=null;seen.clear();},
  resumeTap(){return queued?coordinator.tap(queued):Promise.resolve();},
  async refresh(requestPermission=false):Promise<ChatNotificationEnableResult> {
   if(pending){
    if(!requestPermission||pendingPermission)return pending;
    const origin=deps.identity(),at=revision;
    await pending;
    if(!same(origin,at))return {status:"session-changed"};
    return coordinator.refresh(true);
   }
   const origin=deps.identity(),at=revision;
   if(!origin.enabled||!origin.active||!origin.owner||!origin.tenantId)return {status:"unavailable"};
   let deadline=Infinity,afterPermission=false;
   const current=()=>same(origin,at)&&Date.now()<deadline;
   const bounded=<T>(operation:()=>Promise<T>):Promise<T>=>{
    const remaining=deadline-Date.now();
    if(remaining<=0)return Promise.reject(new Error("Notification enrollment timed out"));
    return new Promise<T>((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error("Notification enrollment timed out")),remaining);
     Promise.resolve().then(()=>{if(!current())throw new Error("Notification session changed");return operation();})
      .then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
   };
   const ticket={};
   const work=(async():Promise<ChatNotificationEnableResult>=>{
    try {
     if(requestPermission)permissionTicket=ticket;
     const granted=await deps.permission(requestPermission);if(!same(origin,at,false))return {status:"session-changed"};
     if(!granted)return {status:"permission-denied"};
     afterPermission=true;
     // The OS permission dialog is deliberately untimed. All subsequent native
     // token, SecureStore and server work shares one bounded enrollment budget.
     deadline=Date.now()+15_000;
     if(requestPermission&&!deps.identity().active)await new Promise<void>((resolve,reject)=>{
      const check=()=>{
       if(!same(origin,at,false)||Date.now()>=deadline){reject(new Error("Notification permission context changed"));return;}
       if(deps.identity().active){resolve();return;}
       setTimeout(check,50);
      };check();
     });
     if(permissionTicket===ticket)permissionTicket=null;
     const token=await bounded(deps.token);if(!current())return same(origin,at)?{status:"unavailable",retryable:true}:{status:"session-changed"};
     const registered=await bounded(()=>deps.register(token,origin.tenantId!,current));
     if(!same(origin,at))return {status:"session-changed"};
     return !current()?{status:"unavailable",retryable:true}:{status:registered?"enabled":"unavailable"};
    }catch(error){return !same(origin,at,false)?{status:"session-changed"}:afterPermission&&retryableSetupError(error)?{status:"unavailable",retryable:true}:{status:"unavailable"};}
    finally{if(permissionTicket===ticket)permissionTicket=null;}
   })();pendingPermission=requestPermission;pending=work;
   try{return await work;}finally{if(pending===work)pending=null;}
  },
  async tap(data:unknown) {
   if(!data||typeof data!=='object')return;
   const {type,eventId}=data as Record<string,unknown>;
   if(type!=='phone11_chat'||typeof eventId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)||seen.has(eventId))return;
   queued={type,eventId};
   const origin=deps.identity(),at=revision;
   if(!origin.owner||!origin.enabled||!origin.active||tapWork)return;
   const current=()=>same(origin,at);
   const work=(async()=>{
    try {const destination=await deps.resolve(eventId,current);
     if(!current())return;
     seen.add(eventId);if(seen.size>128)seen.delete(seen.values().next().value!);
     if((queued as {eventId?:string}|null)?.eventId!==eventId)return;
     queued=null;
     if(destination)deps.open(destination);else deps.unavailable?.();
    }catch{if(current()&&(queued as {eventId?:string}|null)?.eventId===eventId){queued=null;deps.unavailable?.();}}
   })();tapWork=work;
   try{await work;}finally{if(tapWork===work){tapWork=null;
    if(queued && (queued as {eventId?:string}).eventId!==eventId)await coordinator.resumeTap();
   }}

  },
 };
 return coordinator;
}
