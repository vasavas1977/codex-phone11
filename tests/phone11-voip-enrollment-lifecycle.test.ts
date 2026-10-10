import {afterEach,describe,expect,it,vi} from "vitest";
import {createVoipEnrollmentLifecycle} from "../lib/push/enrollment-lifecycle";
afterEach(()=>vi.useRealTimers());
function harness(active=true){
 let state={owner:{} as object|null,account:{} as object|null,ready:true,busy:false};
 const refresh=vi.fn(async(_signal:AbortSignal)=>{});
 const lifecycle=createVoipEnrollmentLifecycle({snapshot:()=>state,refresh},active);
 return {refresh,lifecycle,set:(patch:Partial<typeof state>)=>{state={...state,...patch};lifecycle.changed();}};
}
describe("foreground incoming-call enrollment maintenance",()=>{
 it("starts without blocking the caller and refreshes periodically while foreground",async()=>{
  vi.useFakeTimers();const h=harness();h.lifecycle.start();expect(h.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);expect(h.refresh).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15*60_000);expect(h.refresh).toHaveBeenCalledTimes(2);h.lifecycle.dispose();
 });
 it("refreshes a replacement login even when the native stack was already ready",async()=>{
  vi.useFakeTimers();const h=harness();h.lifecycle.start();await vi.advanceTimersByTimeAsync(0);
  h.set({owner:null,account:null});h.set({owner:{},account:{}});await vi.advanceTimersByTimeAsync(0);
  expect(h.refresh).toHaveBeenCalledTimes(2);h.lifecycle.dispose();
 });
 it("does nothing while background and refreshes on return",async()=>{
  vi.useFakeTimers();const h=harness(false);h.lifecycle.start();await vi.advanceTimersByTimeAsync(60_000);expect(h.refresh).not.toHaveBeenCalled();
  h.lifecycle.setActive(true);await vi.advanceTimersByTimeAsync(0);expect(h.refresh).toHaveBeenCalledOnce();h.lifecycle.dispose();
 });
 it("skips live calls and refreshes after the last call ends",async()=>{
  vi.useFakeTimers();const h=harness();h.set({busy:true});h.lifecycle.start();await vi.advanceTimersByTimeAsync(60_000);expect(h.refresh).not.toHaveBeenCalled();
  h.set({busy:false});await vi.advanceTimersByTimeAsync(0);expect(h.refresh).toHaveBeenCalledOnce();h.lifecycle.dispose();
 });
 it("waits for the current owned SIP account to be ready",async()=>{
  vi.useFakeTimers();const h=harness();h.set({ready:false});h.lifecycle.start();await vi.advanceTimersByTimeAsync(30_000);expect(h.refresh).not.toHaveBeenCalled();
  h.set({ready:true});await vi.advanceTimersByTimeAsync(0);expect(h.refresh).toHaveBeenCalledOnce();h.lifecycle.dispose();
 });
 it("retries a transient failure after30seconds without duplicate overlapping attempts",async()=>{
  vi.useFakeTimers();const h=harness();h.refresh.mockRejectedValueOnce(new Error("offline"));h.lifecycle.start();await vi.advanceTimersByTimeAsync(0);
  h.lifecycle.changed();await vi.advanceTimersByTimeAsync(29999);expect(h.refresh).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(1);expect(h.refresh).toHaveBeenCalledTimes(2);h.lifecycle.dispose();
 });
 it("aborts an in-flight refresh immediately on call start, background or owner replacement",async()=>{
  vi.useFakeTimers();for(const trigger of ["call","background","owner"]){const h=harness();h.refresh.mockImplementation(()=>new Promise(()=>{}));h.lifecycle.start();await vi.advanceTimersByTimeAsync(0);
   const signal=h.refresh.mock.calls[0][0];if(trigger==="call")h.set({busy:true});else if(trigger==="background")h.lifecycle.setActive(false);else h.set({owner:{}});
   expect(signal.aborted).toBe(true);h.lifecycle.dispose();await vi.advanceTimersByTimeAsync(10000);
  }
 });
 it("old successful completion cannot postpone refresh of a replacement account",async()=>{
  vi.useFakeTimers();const h=harness();let finish!:()=>void;h.refresh.mockImplementationOnce(()=>new Promise<void>(yes=>{finish=yes;}));h.lifecycle.start();await vi.advanceTimersByTimeAsync(0);
  h.set({owner:{},account:{}});finish();await vi.advanceTimersByTimeAsync(1);expect(h.refresh).toHaveBeenCalledTimes(2);h.lifecycle.dispose();
 });
 it("bounds a hung refresh and observes its late rejection",async()=>{
  vi.useFakeTimers();const h=harness();let reject!:(e:Error)=>void;h.refresh.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));h.lifecycle.start();await vi.advanceTimersByTimeAsync(10000);
  expect(h.refresh.mock.calls[0][0].aborted).toBe(true);reject(new Error("late"));await vi.advanceTimersByTimeAsync(30000);expect(h.refresh).toHaveBeenCalledTimes(2);h.lifecycle.dispose();
 });
});
