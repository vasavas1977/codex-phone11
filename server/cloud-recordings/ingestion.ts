import { createCloudRecordingRepository } from './repository';
/** Trusted PBX/storage integration only; never exposed as a user-controlled RPC. */
export async function ingestStoredRecording(callUuid:string,storageKey:string,captureToken:string):Promise<boolean> {
 if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED!=="true")return false;
 const repo=createCloudRecordingRepository();
 if(!await repo.registerCall(callUuid))return false;
 return repo.recordingStored(callUuid,storageKey,captureToken);
}
