import {EventEmitter} from 'node:events';
import {generateKeyPairSync} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createApnsAlertSender} from '../server/push/apns';
const pem=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
const token={platform:'ios' as const,tokenType:'apns' as const,token:'a'.repeat(64),bundleId:'test.phone11'};
const payload={eventId:'00000000-0000-4000-8000-000000000001',expiresAt:1_600_000};
function fixture(status=200,event?:string) {
 const headers:any[]=[],bodies:any[]=[];const connect=vi.fn(()=>{
  const session=new EventEmitter() as any,stream=new EventEmitter() as any;
  session.destroy=vi.fn();stream.close=vi.fn();session.request=(h:any)=>{headers.push(h);return stream;};
  stream.end=(body:string)=>{bodies.push(JSON.parse(body));queueMicrotask(()=>{if(event){stream.emit(event,new Error('private value'));return;}stream.emit('response',{':status':status});stream.emit('data',Buffer.from(JSON.stringify({reason:'TooManyRequests'})));stream.emit('end');});};return session;
 });
 const sender=createApnsAlertSender({connect:connect as any,readKey:async()=>pem,now:()=>1_000_000,loadConfig:()=>({keyPath:'/unused',keyId:'KEY1234567',teamId:'TEAM123456',bundleId:'test.phone11',environment:'production'})});
 return {sender,connect,headers,bodies};
}
it('ordinary alert uses plain topic, bounded offline expiry and generic opaque payload',async()=>{const f=fixture();await f.sender(token,payload);expect(f.headers[0]).toMatchObject({'apns-topic':'test.phone11','apns-push-type':'alert','apns-expiration':'1600'});expect(f.bodies[0]).toEqual({aps:{alert:{title:'Phone11',body:'New message'},sound:'default'},type:'phone11_chat',eventId:payload.eventId});});
it.each([NaN,Infinity,999_999,1_600_001])('rejects invalid or excessive expiry %s before network',async expiresAt=>{const f=fixture();await expect(f.sender(token,{...payload,expiresAt})).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();});
it('never accepts VoIP tokens on the ordinary alert path',async()=>{const f=fixture();await expect(f.sender({...token,tokenType:'voip'},payload)).rejects.toThrow('configuration');expect(f.connect).not.toHaveBeenCalled();});
it.each([{status:429},{status:200,event:'error'}])('does not replay rejected or uncertain ordinary acceptance %j',async({status,event})=>{const f=fixture(status,event);await expect(f.sender(token,payload)).rejects.toThrow();expect(f.connect).toHaveBeenCalledOnce();});
it('rechecks session/membership immediately before network',async()=>{const f=fixture();await expect(f.sender(token,payload,async()=>false)).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();});
