import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { integrationSecretStatus } from "../pbx/integration-auth";
import { WakeError } from "./wake-repository";
import { wakeService,wakeDeviceCallSchema,wakeOfferSchema,wakeTerminalSchema } from "./wake-service";

export function registerWakeRoutes(app:Express,service:typeof wakeService=wakeService) {
  const base="/api/phone11/wake";
  app.use(base,(_req:Request,res:Response,next:NextFunction)=>{res.setHeader("Cache-Control","no-store");next();},express.json({limit:"4kb"}),
    (error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
      const status=(error as {status?:number})?.status===413?413:400;
      res.status(status).json({error:"Invalid incoming call request"});
    });
  const failure=(res:Response,error:unknown)=>res.status(error instanceof WakeError?error.status:503).json({error:error instanceof WakeError?error.message:"Incoming call service unavailable"});
  const trusted=(req:Request)=>{const status=integrationSecretStatus("PUSH_SHARED_SECRET",req.headers["x-push-secret"]);
    if(status!=="ok") throw new WakeError(status==="unavailable"?503:403);};
  for(const action of ["claim","ready","status","end"] as const) app.post(`${base}/${action}`,async(req,res)=>{
    try {
      const parsed=wakeDeviceCallSchema.safeParse(req.body);
      const authorization=req.headers.authorization;
      if(!parsed.success) return res.status(400).json({error:"Invalid incoming call request"});
      const grant=typeof authorization==="string"?/^Wake ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1]:undefined;
      if(!grant) throw new WakeError(401);
      res.json(await service.device(action,grant,parsed.data));
    } catch(error) {failure(res,error);}
  });
  app.post(`${base}/offer`,async(req,res)=>{
    const controller=new AbortController();
    const close=()=>{if(!res.writableEnded)controller.abort();};res.once("close",close);
    try {
      trusted(req);const input=wakeOfferSchema.safeParse(req.body);
      if(!input.success)return res.status(400).json({error:"Invalid incoming call request"});
      const result=await service.offer(input.data,controller.signal);if(!res.destroyed)res.json(result);
    }catch(error){if(!res.destroyed)failure(res,error);}
    finally{res.off("close",close);}
  });
  app.post(`${base}/terminal`,async(req,res)=>{
    try{trusted(req);const input=wakeTerminalSchema.safeParse(req.body);
      if(!input.success)return res.status(400).json({error:"Invalid incoming call request"});
      await service.terminal(input.data);res.json({ok:true});
    }catch(error){failure(res,error);}
  });
}
