import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import express from "express";
import type {Server} from "node:http";
import {registerWakeRoutes} from "../server/push/wake-routes";
import {WakeError} from "../server/push/wake-repository";
const identity={bindingId:"11111111-1111-4111-8111-111111111111",callUUID:"33333333-3333-4333-8333-333333333333"};
const offer={sipUri:"sip:3001@pilot.invalid",sipCallId:"synthetic-dialog"};
const secret="q".repeat(32),grant="a".repeat(43);
let server:Server,url:string;
let service:{device:ReturnType<typeof vi.fn>;offer:ReturnType<typeof vi.fn>;terminal:ReturnType<typeof vi.fn>};
beforeEach(async()=>{
 service={device:vi.fn(async()=>({v:1,...identity,status:"ready"})),offer:vi.fn(async()=>({v:1,callUUID:identity.callUUID,status:"ready"})),terminal:vi.fn(async()=>{})};
 const app=express();app.set("env","test");registerWakeRoutes(app,service as never);
 await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address || typeof address==="string")throw new Error("Missing test port");url=`http://127.0.0.1:${address.port}/api/phone11/wake`;
 vi.stubEnv("PUSH_SHARED_SECRET",secret);
});
afterEach(async()=>{vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
function post(action:string,body:unknown=identity,headers:Record<string,string>={Authorization:`Wake ${grant}`}){
 return fetch(`${url}/${action}`,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
}
describe("wake HTTP boundary",()=>{
 it.each(["claim","ready","status","end"])("%s authenticates scoped grant and prevents response caching",async action=>{
  const response=await post(action);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({v:1,...identity,status:"ready"});expect(service.device).toHaveBeenCalledWith(action,grant,identity);
 });
 it.each([undefined,"Bearer token","Wake short",`Wake ${grant} extra`])("rejects invalid or missing wake authorization %s",async authorization=>{
  const response=await post("claim",identity,authorization?{Authorization:authorization}:{});expect(response.status).toBe(401);expect(service.device).not.toHaveBeenCalled();expect(response.headers.get("cache-control")).toBe("no-store");
 });
 it("rejects extra fields and malformed identities before entering the service",async()=>{
  for(const body of [{...identity,grant},{...identity,ownerUserId:2},{...identity,callUUID:"not-a-uuid"}])expect((await post("claim",body)).status).toBe(400);
  expect(service.device).not.toHaveBeenCalled();
 });
 it("returns bounded errors without exposing internal credentials",async()=>{
  service.device.mockRejectedValue(new Error("private database URL and SIP password"));const response=await post("claim");
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"Incoming call service unavailable"});
 });
 it("keeps disabled service refusal unavailable rather than reporting success",async()=>{
  service.device.mockRejectedValue(new WakeError(503,"Background incoming calls are not enabled"));expect((await post("claim")).status).toBe(503);
 });
 it("rejects malformed JSON and over4KB bodies with JSON no-store responses",async()=>{
  for(const [body,status] of [["{",400],[JSON.stringify({...identity,padding:"x".repeat(4096)}),413]] as const){
   const response=await fetch(`${url}/claim`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Wake ${grant}`},body});
   expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("no-store");expect(response.headers.get("content-type")).toContain("application/json");
  }
  expect(service.device).not.toHaveBeenCalled();
 });
 it("requires configured integration secret in header for offer and terminal",async()=>{
  for(const action of ["offer","terminal"]){
   const body=action==="offer"?offer:{...offer,status:"cancelled"};
   expect((await post(action,body,{"x-push-secret":"wrong"})).status).toBe(403);
   expect((await post(`${action}?secret=${secret}`,body,{})).status).toBe(403);
  }
  expect(service.offer).not.toHaveBeenCalled();expect(service.terminal).not.toHaveBeenCalled();
  vi.stubEnv("PUSH_SHARED_SECRET","");expect((await post("offer",offer,{"x-push-secret":secret})).status).toBe(503);
 });
 it("trusted offer returns only the correlated call UUID after readiness",async()=>{
  const response=await post("offer",offer,{"x-push-secret":secret});expect(response.status).toBe(200);
  expect(await response.json()).toEqual({v:1,callUUID:identity.callUUID,status:"ready"});expect(service.offer).toHaveBeenCalledWith(offer,expect.any(AbortSignal));
  expect(response.headers.get("cache-control")).toBe("no-store");
 });
 it("trusted terminal validates status and strict shape before forwarding",async()=>{
  expect((await post("terminal",{...offer,status:"connected"},{"x-push-secret":secret})).status).toBe(400);
  expect((await post("terminal",{...offer,status:"cancelled",userId:99},{"x-push-secret":secret})).status).toBe(400);
  expect(service.terminal).not.toHaveBeenCalled();
  const response=await post("terminal",{...offer,status:"ended"},{"x-push-secret":secret});expect(response.status).toBe(200);expect(service.terminal).toHaveBeenCalledWith({...offer,status:"ended"});
 });
 it("client disconnect aborts only its pending longpoll signal",async()=>{
  let release!:(value:unknown)=>void;service.offer.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  const controller=new AbortController();
  const response=fetch(`${url}/offer`,{method:"POST",headers:{"Content-Type":"application/json","x-push-secret":secret},body:JSON.stringify(offer),signal:controller.signal}).catch(error=>error);
  await vi.waitFor(()=>expect(service.offer).toHaveBeenCalled());const signal=service.offer.mock.calls[0][1] as AbortSignal;expect(signal.aborted).toBe(false);
  controller.abort();await response;await vi.waitFor(()=>expect(signal.aborted).toBe(true));release({v:1,callUUID:identity.callUUID,status:"ready"});
 });
});
