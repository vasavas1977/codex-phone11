import { connect } from 'node:net';
import { EslFrames } from '../cloud-recordings/esl-capture';
import type { FreeSwitchConfig } from '../pbx/fs-config';
/** Bounded authenticated ESL exchange. Only the server holds the secret. */
export function createConferenceEsl(config: FreeSwitchConfig, timeoutMs = 5000) {
 if (!config.host || !config.password || /[\r\n]/.test(config.password) || !Number.isInteger(config.port) || config.port<1 || config.port>65535) throw new Error('Invalid conference transport configuration');
 return { api(command: string): Promise<string> {
  if (!/^conference (json_list|[a-zA-Z0-9_-]{1,100} (json_list|mute (\d+|all)|unmute (\d+|all)|kick (\d+|all)|lock|unlock))$/.test(command)) return Promise.reject(new Error('Unsupported conference command'));
  return new Promise((resolve,reject)=>{
   const socket=connect({host:config.host,port:config.port}), parser=new EslFrames();
   let phase='challenge', done=false;
   const finish=(error?:Error,body?:string)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(body!);};
   const timer=setTimeout(()=>finish(new Error('Conference transport unavailable')),Math.min(15000,Math.max(100,timeoutMs)));
   socket.on('error',()=>finish(new Error('Conference transport unavailable')));
   socket.on('end',()=>finish(new Error('Conference transport unavailable')));
   socket.on('data',chunk=>{try {for(const frame of parser.push(chunk)) {
    if(done)return;
    if(phase==='challenge' && frame.headers['content-type']==='auth/request'){phase='auth';socket.write(`auth ${config.password}\n\n`);continue;}
    if(phase==='auth' && frame.headers['reply-text']==='+OK accepted'){phase='response';socket.write(`api ${command}\n\n`);continue;}
    if(phase==='response' && frame.headers['content-type']==='api/response'){finish(undefined,frame.body);continue;}
    throw new Error();
   }} catch {finish(new Error('Conference transport protocol failed'));}});
  });
 }};
}
