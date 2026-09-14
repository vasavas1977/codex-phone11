import express,{type Express} from "express";
import {createServer,type Server} from "node:http";
import {pathToFileURL} from "node:url";
import {createLabFcmService,readLabFcmStartupConfig,registerLabFcmRoutes} from "./push/lab-fcm-routes";

type LabService=Parameters<typeof registerLabFcmRoutes>[1];
type Options={source?:NodeJS.ProcessEnv;now?:number;service?:LabService};

/** Minimal Cloud Run surface. Configuration is validated before any socket opens. */
export function createLabFcmCloudRunApp(options:Options={}):Express{
 const source=options.source??process.env;
 const config=readLabFcmStartupConfig(source,options.now??Date.now());
 const app=express();app.disable("x-powered-by");app.set("trust proxy",false);
 app.get("/health",(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json({ok:true,service:"phone11-fcm-staging-lab",environment:"staging",projectId:"phone11-stage-20260914",build:config.sourceCommit});});
 registerLabFcmRoutes(app,options.service??createLabFcmService({source:()=>source}));
 app.use((_req,res)=>{res.setHeader("Cache-Control","no-store");res.status(404).json({error:"Not found"});});
 return app;
}

export function startLabFcmCloudRun(source:NodeJS.ProcessEnv=process.env):Server{
 const port=Number(source.PORT??"8080");if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid Cloud Run port");
 const server=createServer(createLabFcmCloudRunApp({source}));server.listen(port,"0.0.0.0",()=>console.log(`[phone11-fcm-staging-lab] listening port=${port} build=${source.PHONE11_BUILD_SHA}`));
 process.once("SIGTERM",()=>server.close());return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{startLabFcmCloudRun();}catch{console.error("Phone11 FCM staging lab refused to start: commissioning is unavailable");process.exitCode=1;}
}
