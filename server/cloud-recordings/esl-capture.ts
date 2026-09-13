import { connect, type Socket } from 'node:net';
import { RECORDING_MAX_SECONDS, type CaptureLease, type CaptureTransport } from './capture';
export interface EslFrame { headers: Record<string,string>; body: string }
/** Bounded ESL framing, including frames split across TCP packets. */
export class EslFrames {
 private buffer=Buffer.alloc(0);
 push(chunk:Buffer):EslFrame[]{
  this.buffer=Buffer.concat([this.buffer,chunk]);
  if(this.buffer.length>1024*1024)throw new Error('ESL frame too large');
  const frames:EslFrame[]=[];
  for(;;){
   const end=this.buffer.indexOf('\n\n');if(end<0)break;
   const headers:Record<string,string>={};
   for(const line of this.buffer.subarray(0,end).toString().split('\n')){const at=line.indexOf(':');if(at<1)throw new Error('Invalid ESL header');headers[line.slice(0,at).toLowerCase()]=line.slice(at+1).trim();}
   const raw=headers['content-length']??'0';if(!/^\d{1,7}$/.test(raw))throw new Error('Invalid ESL length');const size=Number(raw);if(size>512*1024)throw new Error('ESL body too large');
   if(this.buffer.length<end+2+size)break;
   frames.push({headers,body:this.buffer.subarray(end+2,end+2+size).toString()});this.buffer=this.buffer.subarray(end+2+size);
  }
  return frames;
 }
}
export interface EslConfig {host:string;port:number;password:string;announcementPath:string;timeoutMs?:number}
function event(frame:EslFrame):Record<string,string>{
 if(frame.headers['content-type']!=='text/event-json')return {};
 return JSON.parse(frame.body);
}
/** One bounded authenticated connection per operation: no shared command/event races. */
export function createEslCaptureTransport(config:EslConfig):CaptureTransport & { waitForRecordStop(): Promise<{channelUuid:string;path:string}> } {
 if(!config.password || /[\r\n]/.test(config.password) || !Number.isInteger(config.port) || config.port<1 || config.port>65535
  || !/^\/opt\/phone11ai\/prompts\/[a-zA-Z0-9_-]+\.wav$/.test(config.announcementPath))throw new Error('Invalid capture transport configuration');
 const limit=Math.min(30000,Math.max(1000,config.timeoutMs??15000));
 async function session<T>(operation:(send:(s:string)=>void,frame:EslFrame)=>T|undefined):Promise<T>{
  return new Promise((resolve,reject)=>{
   const socket:Socket=connect({host:config.host,port:config.port});const parser=new EslFrames();let authenticated=false;let sent=false;let done=false;
   const finish=(error?:Error,value?:T)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value as T);};
   const timer=setTimeout(()=>finish(new Error('Capture transport timeout')),limit);
   socket.on('error',()=>finish(new Error('Capture transport unavailable')));socket.on('end',()=>finish(new Error('Capture transport ended')));
   const send=(s:string)=>{if(/[\r\n]/.test(s))throw new Error('Invalid ESL command');socket.write(s+'\n\n');};
   socket.on('data',data=>{try{for(const frame of parser.push(data)){
    if(!authenticated){
     if(frame.headers['content-type']==='auth/request'&&!sent){sent=true;send('auth '+config.password);continue;}
     if(sent&&frame.headers['reply-text']==='+OK accepted'){authenticated=true;const result=operation(send,{headers:{'content-type':'authenticated'},body:''});if(result!==undefined)finish(undefined,result);continue;}
     throw new Error('Capture transport authentication failed');
    }
    const result=operation(send,frame);if(result!==undefined)finish(undefined,result);
   }}catch{finish(new Error('Capture transport protocol failed'));}});
  });
 }
 return {
  async startRecording(lease, seconds, onStopped){
   if(seconds!==RECORDING_MAX_SECONDS || !/^[0-9a-f-]{36}$/i.test(lease.channelUuid) || !/^[0-9a-f-]{36}$/i.test(lease.token)
    || !Number.isSafeInteger(lease.tenantId) || lease.tenantId<=0
    || lease.path!==`/var/lib/freeswitch/recordings/phone11/${lease.tenantId}/${lease.token}.wav`)throw new Error('Invalid bounded recording');
   // This connection survives the start ACK. An autonomous native limit stop is
   // observed without issuing a second stop command or waiting for call hangup.
   await new Promise<void>((resolve,reject)=>{
    const socket=connect({host:config.host,port:config.port}),parser=new EslFrames();
    let phase='auth',accepted=false,ended=false,closed=false;
    let timer:ReturnType<typeof setTimeout>;
    const close=()=>{if(closed)return;closed=true;clearTimeout(timer);socket.destroy();};
    const fail=()=>{close();if(!accepted)reject(new Error('Recording start observation failed'));};
    const complete=()=>{if(!accepted||!ended||closed)return;close();void onStopped().catch(()=>{/* Durable completion lease permits retry. */});};
    const send=(command:string)=>socket.write(command+'\n\n');
    timer=setTimeout(fail,limit);
    socket.on('error',fail);socket.on('end',fail);
    socket.on('data',chunk=>{try{for(const frame of parser.push(chunk)){
     if(closed)return;
     if(phase==='auth'&&frame.headers['content-type']==='auth/request'){phase='authReply';send('auth '+config.password);continue;}
     if(phase==='authReply'){
      if(frame.headers['reply-text']!=='+OK accepted')throw new Error();phase='subscribe';send('event json RECORD_STOP');continue;
     }
     if(phase==='subscribe'&&frame.headers['content-type']==='command/reply'){
      if(!frame.headers['reply-text']?.startsWith('+OK'))throw new Error();phase='start';send(`api uuid_record ${lease.channelUuid} start ${lease.path} ${seconds}`);continue;
     }
     if(phase==='start'&&frame.headers['content-type']==='api/response'){
      if(!frame.body.startsWith('+OK'))throw new Error();accepted=true;phase='watch';clearTimeout(timer);
      timer=setTimeout(close,(seconds+60)*1000);timer.unref();resolve();complete();continue;
     }
     const e=event(frame);
     if((phase==='start'||phase==='watch')&&e['Event-Name']==='RECORD_STOP'&&e['Unique-ID']===lease.channelUuid&&e['Record-File-Path']===lease.path){ended=true;complete();}
    }}catch{fail();}});
   });
  },
  async waitForRecordStop(){
   return session<{channelUuid:string;path:string}>((send,frame)=>{
    if(frame.headers['content-type']==='authenticated'){send('event json RECORD_STOP');return;}
    const e=event(frame);
    if(e['Event-Name']==='RECORD_STOP'&&/^[0-9a-f-]{36}$/i.test(e['Unique-ID']??'')&&/^\/var\/lib\/freeswitch\/recordings\/phone11\/[1-9][0-9]*\/[a-zA-Z0-9_-]{1,128}\.wav$/.test(e['Record-File-Path']??''))return {channelUuid:e['Unique-ID'],path:e['Record-File-Path']};
   });
  },
  async api(command){
   const stop=/^uuid_record ([0-9a-f-]{36}) stop (\/var\/lib\/freeswitch\/recordings\/phone11\/[1-9][0-9]*\/[0-9a-f-]{36}\.wav)$/i.exec(command);
   if(stop){let subscribed=false,accepted=false,ended=false;
    return session<string>((send,frame)=>{
     if(frame.headers['content-type']==='authenticated'){send('event json RECORD_STOP');return;}
     if(!subscribed&&frame.headers['content-type']==='command/reply'){
      if(!frame.headers['reply-text']?.startsWith('+OK'))throw new Error('Stop subscription failed');subscribed=true;send('api '+command);return;
     }
     if(frame.headers['content-type']==='api/response'){if(!frame.body.startsWith('+OK'))throw new Error('Recording stop failed');accepted=true;}
     const e=event(frame);if(e['Event-Name']==='RECORD_STOP'&&e['Unique-ID']===stop[1]&&e['Record-File-Path']===stop[2])ended=true;
     if(accepted&&ended)return '+OK recording stopped';
    });
   }
   return session<string>((send,frame)=>{if(frame.headers['content-type']==='authenticated'){send('api '+command);return;}
   if(frame.headers['content-type']==='api/response')return frame.body;
  });},
  async announceBoth(lease:CaptureLease){
   let phase='subscribe';let peer='';let accepted=false;const completed=new Set<string>();
   await session<boolean>((send,frame)=>{
    if(frame.headers['content-type']==='authenticated'){send('event json PLAYBACK_STOP');return;}
    if(phase==='subscribe'&&frame.headers['content-type']==='command/reply'){
     if(!frame.headers['reply-text']?.startsWith('+OK'))throw new Error('Subscription failed');phase='peer';send(`api uuid_getvar ${lease.channelUuid} signal_bond`);return;
    }
    if(phase==='peer'&&frame.headers['content-type']==='api/response'){
     peer=frame.body.trim();if(!/^[0-9a-f-]{36}$/i.test(peer)||peer===lease.channelUuid)throw new Error('Bridged peer unavailable');phase='play';send(`api uuid_broadcast ${lease.channelUuid} ${config.announcementPath} both`);return;
    }
    if(phase==='play'&&frame.headers['content-type']==='api/response'){if(!frame.body.startsWith('+OK'))throw new Error('Announcement failed');accepted=true;if(completed.size===2)return true;}
    const e=event(frame);
    if(phase==='play'&&e['Event-Name']==='PLAYBACK_STOP'&&[lease.channelUuid,peer].includes(e['Unique-ID'])&&e['Playback-File-Path']===config.announcementPath){
     if(e['Playback-Status']!=='done')throw new Error('Announcement interrupted');
     completed.add(e['Unique-ID']);if(accepted&&completed.size===2)return true;
    }
   });
  },
 };
}
