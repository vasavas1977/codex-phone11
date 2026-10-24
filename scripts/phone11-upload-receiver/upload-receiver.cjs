'use strict';
const {createRequire}=require('node:module'),hostFs=require('node:fs'),hostPath=require('node:path'),hostCrypto=require('node:crypto'),hostHttp=require('node:http');
const SOURCE_BINDING={"baseInstalledSourceSha256":"57e80ecaef64f32baf6d7195ab4f63316bb6ccc802b28d1bd2595878f3bef000","ownerPatchedSourceSha256":"b59cab640b716e6eed8d833fede301a7dde02aee4b4ec22c8b3d953245508cda","repositoryMethods":["registerCall","recordingStored"],"runtimeBindingProvided":false,"candidateRevision":"v2-lifecycle-cancellation"};
const IDENTITY_SQL="SELECT current_user=$1 AND session_user=$1 AS exact,NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AS restricted,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())AS tls,NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid OR roleid=pg_roles.oid)AS no_memberships,NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=pg_roles.oid)AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=pg_roles.oid)AS no_ownership,NOT has_database_privilege(current_user,current_database(),'CREATE')AS no_db_create,NOT has_schema_privilege(current_user,'public','CREATE')AS no_schema_create FROM pg_roles WHERE rolname=current_user";
const BINDING_SQL="SELECT current_database()=$1 AS database_name,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database())=$2 AS database_oid,(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user)=$3 AS role_oid,current_setting('server_version_num')=$4 AS server_version";
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
function checkedBinding(input){
 need(input&&input.schema==='PHONE11_UPLOAD_RECEIVER_PRIVATE_BINDING_V1','BINDING_REQUIRED');
 need(Number.isInteger(input.port)&&input.port>=1024&&input.port<=65535&&['127.0.0.1','0.0.0.0'].includes(input.listenHost),'EXPLICIT_LISTENER_REQUIRED');
 const storage=input.storage,db=input.database,identity=input.processIdentity;
 need(storage&&typeof storage.path==='string'&&storage.path.length<=512&&storage.path!=='/'&&hostPath.isAbsolute(storage.path)&&hostPath.normalize(storage.path)===storage.path&&!storage.path.includes('\0'),'EXPLICIT_STORAGE_REQUIRED');
 need(['uid','gid','mode'].every(k=>Number.isInteger(storage[k])&&storage[k]>=0)&&storage.mode<=0o777,'EXPLICIT_STORAGE_METADATA_REQUIRED');
 need(identity&&['uid','gid'].every(k=>Number.isInteger(identity[k])&&identity[k]>=0),'EXPLICIT_PROCESS_IDENTITY_REQUIRED');
 need(db&&typeof db.host==='string'&&/^[a-zA-Z0-9.-]{1,253}$/.test(db.host)&&Number.isInteger(db.port)&&db.port>0&&db.port<=65535,'EXPLICIT_DATABASE_ENDPOINT_REQUIRED');
 need(['name','role'].every(k=>typeof db[k]==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(db[k]))&&typeof db.password==='string'&&db.password.length>0&&db.password.length<=4096,'EXPLICIT_DATABASE_IDENTITY_REQUIRED');
 need(['databaseOid','roleOid','serverVersion'].every(k=>typeof db[k]==='string'&&/^[1-9][0-9]{0,9}$/.test(db[k])),'EXPLICIT_DATABASE_PINS_REQUIRED');
 need(typeof db.ca==='string'&&db.ca.length<=65536&&db.ca.startsWith('-----BEGIN CERTIFICATE-----')&&db.ca.includes('-----END CERTIFICATE-----'),'EXPLICIT_DATABASE_CA_REQUIRED');
 need(input.captureEnabled===true&&typeof input.integrationSecret==='string'&&input.integrationSecret.length>=24&&input.integrationSecret.length<=4096&&!/change[-_ ]?me|example|placeholder/i.test(input.integrationSecret),'EXPLICIT_CAPTURE_AND_SECRET_REQUIRED');
 return Object.freeze({port:input.port,listenHost:input.listenHost,storage:Object.freeze({path:storage.path,uid:storage.uid,gid:storage.gid,mode:storage.mode}),processIdentity:Object.freeze({uid:identity.uid,gid:identity.gid}),database:Object.freeze(Object.fromEntries(['host','port','name','role','password','databaseOid','roleOid','serverVersion','ca'].map(k=>[k,db[k]]))),integrationSecret:input.integrationSecret});
}
function defaultDependencies(){const req=createRequire('/app/package.json');return{pg:req('pg'),express:req('express'),TRPCError:req('@trpc/server').TRPCError,fs:hostFs,http:hostHttp,process:globalThis.process};}
function createUploadReceiver(input,injected){
 const binding=checkedBinding(input),deps=injected||defaultDependencies();
 const pg=deps.pg,TRPCError=deps.TRPCError,createHash4=hostCrypto.createHash,createHash7=hostCrypto.createHash,timingSafeEqual=hostCrypto.timingSafeEqual,fs5=deps.fs,path3=hostPath,Router4=deps.express.Router,raw2=deps.express.raw;
 // Actual source sees only these explicitly bound values; no ambient database,
 // dotenv, capture-off, secret or storage fallback enters this receiver.
 const process={env:{PG_HOST:binding.database.host,PG_PORT:String(binding.database.port),PG_USER:binding.database.role,PG_PASSWORD:binding.database.password,PG_DATABASE:binding.database.name,PG_SSL:'true',PG_SSL_REJECT_UNAUTHORIZED:'true',PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED:'true',FS_SHARED_SECRET:binding.integrationSecret}};
 const console={error(){},warn(){},log(){}};let _pool=null;
 const RECORDINGS_BASE=binding.storage.path,storageRouter=Router4(),verifyFsAuth2=requireIntegrationSecret('FS_SHARED_SECRET','x-fs-secret');
 function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return void 0;
}
function getSslConfig(connectionString) {
  const sslMode = firstEnv("PG_SSL", "DB_SSL", "POSTGRES_SSL", "DATABASE_SSL")?.toLowerCase();
  if (sslMode === "false" || sslMode === "0" || sslMode === "disable" || connectionString?.includes("sslmode=disable")) {
    return false;
  }
  return {
    rejectUnauthorized: firstEnv("PG_SSL_REJECT_UNAUTHORIZED", "DB_SSL_REJECT_UNAUTHORIZED") === "true"
  };
}
function buildPgConfig() {
  const discrete = {
    host: firstEnv("PG_HOST", "DB_HOST", "POSTGRES_HOST"),
    port: firstEnv("PG_PORT", "DB_PORT", "POSTGRES_PORT"),
    user: firstEnv("PG_USER", "DB_USER", "POSTGRES_USER"),
    password: firstEnv("PG_PASSWORD", "DB_PASSWORD", "POSTGRES_PASSWORD"),
    database: firstEnv("PG_DATABASE", "DB_NAME", "DB_DATABASE", "POSTGRES_DB")
  };
  const missing = [
    ["host", discrete.host],
    ["user", discrete.user],
    ["password", discrete.password],
    ["database", discrete.database]
  ].filter(([, value]) => !value).map(([key]) => key);
  const hasDiscretePgConfig = missing.length === 0;
  const connectionString = process.env.PG_CONNECTION_STRING ?? (hasDiscretePgConfig ? void 0 : process.env.DATABASE_URL);
  const common = {
    ssl: getSslConfig(connectionString),
    max: 20,
    idleTimeoutMillis: 3e4,
    connectionTimeoutMillis: 5e3
  };
  if (connectionString) {
    return {
      ...common,
      connectionString
    };
  }
  if (missing.length > 0) {
    throw new Error(`[PBX DB] Missing required database settings: ${missing.join(", ")}`);
  }
  return {
    ...common,
    ssl: getSslConfig(),
    host: discrete.host,
    port: parseInt(discrete.port ?? "5432", 10),
    user: discrete.user,
    password: discrete.password,
    database: discrete.database
  };
}
function getPool() {
  if (!_pool) {
    _pool = new pg.Pool(buildPgConfig());
    _pool.on("error", (err) => {
      console.error("[PBX DB] Unexpected pool error:", err.message);
    });
  }
  return _pool;
}
async function query(text2, params) {
  const pool = getPool();
  const start = Date.now();
  try {
    const result = await pool.query(text2, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[PBX DB] Slow query (${duration}ms):`, text2.substring(0, 100));
    }
    return result;
  } catch (error) {
    console.error("[PBX DB] Query error:", error.message, "SQL:", text2.substring(0, 200));
    throw error;
  }
}
var uuid = /^[a-zA-Z0-9_-]{1,128}$/;
var unavailable = () => new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
function integrationSecretStatus(name, supplied) {
  const configured = process.env[name];
  if (!configured || configured.length < 24 || /change[-_ ]?me|example|placeholder/i.test(configured)) return "unavailable";
  if (typeof supplied !== "string" || supplied.length > 4096) return "forbidden";
  const digest = (value) => createHash4("sha256").update(value).digest();
  return timingSafeEqual(digest(configured), digest(supplied)) ? "ok" : "forbidden";
}
function requireIntegrationSecret(name, header) {
  return (req, res, next) => {
    const status = integrationSecretStatus(name, req.headers[header]);
    if (status === "unavailable") {
      res.status(503).json({ error: "Integration is not configured" });
      return;
    }
    if (status !== "ok") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
async function ingestStoredRecording(callUuid3, storageKey, captureToken) {
  if (process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED !== "true") return false;
  const repo2 = createCloudRecordingRepository();
  if (!await repo2.registerCall(callUuid3)) return false;
  return repo2.recordingStored(callUuid3, storageKey, captureToken);
}
var MAX_RECORDING_SIZE = 100 * 1024 * 1024;
var validUuid = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
var validTenant = (value) => Number.isSafeInteger(value) && value > 0;
async function storeRecording(tenantId2, callUuid3, fileBuffer, format = "wav", idempotent = false) {
  if (!validTenant(tenantId2) || !validUuid(callUuid3) || format !== "wav" || !fileBuffer.length || fileBuffer.length > MAX_RECORDING_SIZE) {
    throw new Error("Invalid recording upload");
  }
  const now = /* @__PURE__ */ new Date();
  const dir = path3.join(RECORDINGS_BASE, String(tenantId2), `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  await fs5.promises.mkdir(dir, { recursive: true, mode: 448 });
  const base = await fs5.promises.realpath(RECORDINGS_BASE);
  const realDir = await fs5.promises.realpath(dir);
  if (!realDir.startsWith(path3.join(base, String(tenantId2)) + path3.sep)) throw new Error("Invalid recording directory");
  const filePath = path3.join(realDir, `${callUuid3}.wav`);
  try {
    await fs5.promises.writeFile(filePath, fileBuffer, { flag: "wx", mode: 384 });
  } catch (error) {
    if (!idempotent || error.code !== "EEXIST") throw error;
    const handle = await fs5.promises.open(filePath, fs5.constants.O_RDONLY | fs5.constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size !== fileBuffer.length) throw new Error("Recording identity mismatch");
      const bytes = await handle.readFile();
      if (!createHash7("sha256").update(bytes).digest().equals(createHash7("sha256").update(fileBuffer).digest())) throw new Error("Recording identity mismatch");
    } finally {
      await handle.close();
    }
  }
  return { filePath, fileSize: fileBuffer.length };
}
function createCloudRecordingRepository(db = getPool(), captureAvailable = () => process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true") {
async function transaction(fn) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
return {
async registerCall(callUuid3) {
      if (!uuid.test(callUuid3)) throw unavailable();
      return transaction(async (c) => {
        const result = await c.query(`SELECT cr.*,cl.extension_id FROM call_records cr JOIN call_legs cl ON cl.call_record_id=cr.id AND cl.tenant_id=cr.tenant_id
     JOIN extensions e ON e.id=cl.extension_id AND e.tenant_id=cr.tenant_id JOIN tenants t ON t.id=e.tenant_id
     WHERE cr.call_uuid=$1 AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'
     AND cr.direction IN ('inbound','outbound') ORDER BY cl.id`, [callUuid3]);
        const rows = result.rows;
        if (!rows.length || new Set(rows.map((r2) => r2.extension_id)).size !== 1) return false;
        const r = rows[0];
        const p = await c.query("SELECT * FROM phone11_recording_policies WHERE tenant_id=$1 FOR SHARE", [r.tenant_id]);
        const policy = p.rows[0];
        const native = await c.query(`SELECT DISTINCT wc.id FROM phone11_wake_calls wc JOIN phone11_wake_bindings wb ON wb.id=wc.binding_id
     JOIN call_legs cl ON cl.sip_call_id=wc.sip_call_id WHERE cl.call_record_id=$1 AND cl.tenant_id=$2
     AND wb.tenant_id=$2 AND wb.extension_id=$3
     UNION SELECT w.wake_uuid AS id FROM phone11_recording_wake_links w JOIN call_legs cl ON cl.sip_call_id=w.sip_call_id
     WHERE cl.call_record_id=$1 AND cl.tenant_id=$2 AND w.tenant_id=$2 AND w.extension_id=$3`, [r.id, r.tenant_id, r.extension_id]);
        await c.query(
          `INSERT INTO phone11_cloud_recordings(call_uuid,tenant_id,extension_id,native_history_id,number,direction,started_at,ended_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7::timestamptz+($9::integer*interval '1 day')) ON CONFLICT(call_uuid) DO UPDATE SET ended_at=GREATEST(phone11_cloud_recordings.started_at,EXCLUDED.ended_at),
      native_history_id=COALESCE(phone11_cloud_recordings.native_history_id,EXCLUDED.native_history_id)
      WHERE phone11_cloud_recordings.tenant_id=EXCLUDED.tenant_id AND phone11_cloud_recordings.extension_id=EXCLUDED.extension_id`,
          [callUuid3, r.tenant_id, r.extension_id, native.rows.length === 1 ? `native-wake:${native.rows[0].id}` : null, r.direction === "inbound" ? r.from_number : r.to_number, r.direction, r.started_at, r.ended_at, policy?.retention_days ?? 30]
        );
        return true;
      });
    },
async recordingStored(callUuid3, storageKey, captureToken) {
      return transaction(async (c) => {
        const result = await c.query(`SELECT r.*,p.mode,p.ai_enabled FROM phone11_cloud_recordings r JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
     WHERE r.call_uuid=$1 AND r.expires_at>clock_timestamp() FOR UPDATE OF p,r`, [callUuid3]);
        const r = result.rows[0];
        if (!r || r.mode === "off" || !captureAvailable() || r.capture_token !== captureToken || !["recording", "ready"].includes(r.recording_status)) return false;
        if (r.recording_status === "ready") return r.storage_key === storageKey;
        const stored = await c.query("SELECT 1 FROM call_records WHERE call_uuid=$1 AND tenant_id=$2 AND recording_url=$3", [callUuid3, r.tenant_id, storageKey]);
        if (!stored.rows.length) return false;
        await c.query("UPDATE phone11_cloud_recordings SET recording_status='ready',storage_key=$2,summary_status=$3 WHERE call_uuid=$1", [callUuid3, storageKey, r.ai_enabled ? "queued" : "off"]);
        if (r.ai_enabled) await c.query("INSERT INTO phone11_recording_jobs(call_uuid) VALUES($1) ON CONFLICT(call_uuid) DO NOTHING", [callUuid3]);
        return true;
      });
    }
};
}
storageRouter.post("/upload", verifyFsAuth2, raw2({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: MAX_RECORDING_SIZE }), async (req, res) => {
  const callUuid3 = req.query.call_uuid;
  const tenantId2 = typeof req.query.tenant_id === "string" ? Number(req.query.tenant_id) : NaN;
  if (!validUuid(callUuid3) || !validTenant(tenantId2) || !Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: "Provide a WAV body and valid call_uuid and tenant_id" });
    return;
  }
  try {
    const call2 = await query("SELECT id FROM call_records WHERE call_uuid = $1 AND tenant_id = $2", [callUuid3, tenantId2]);
    if (!call2.rows.length) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    let stored;
    const captureToken = typeof req.query.capture_token === "string" ? req.query.capture_token : "";
    if (process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true") {
      if (!/^[a-f0-9-]{36}$/i.test(captureToken)) {
        res.status(409).json({ error: "Capture authorization required" });
        return;
      }
      const authorized2 = await query(`SELECT r.storage_key,r.recording_status FROM phone11_cloud_recordings r
       JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id WHERE r.call_uuid=$1 AND r.tenant_id=$2
       AND r.capture_token=$3 AND r.recording_status IN ('recording','ready') AND r.expires_at>clock_timestamp() AND p.mode<>'off'
       AND r.extension_id=(SELECT MIN(cl.extension_id) FROM call_records cr
        JOIN call_legs cl ON cl.call_record_id=cr.id AND cl.tenant_id=cr.tenant_id
        JOIN extensions e ON e.id=cl.extension_id AND e.tenant_id=cr.tenant_id
        JOIN tenants t ON t.id=e.tenant_id
        WHERE cr.call_uuid=r.call_uuid AND cr.tenant_id=r.tenant_id
        AND e.status='active' AND e.deleted_at IS NULL AND t.status='active'
        AND cr.direction IN ('inbound','outbound') HAVING COUNT(DISTINCT cl.extension_id)=1)`, [callUuid3, tenantId2, captureToken]);
      if (authorized2.rows.length !== 1) {
        res.status(409).json({ error: "Capture authorization unavailable" });
        return;
      }
    }
    const existing = await query("SELECT recording_url FROM call_records WHERE call_uuid=$1 AND tenant_id=$2", [callUuid3, tenantId2]);
    if (captureToken && existing.rows[0]?.recording_url) {
      const base = await fs5.promises.realpath(RECORDINGS_BASE);
      const filePath = await fs5.promises.realpath(existing.rows[0].recording_url);
      if (!filePath.startsWith(path3.join(base, String(tenantId2)) + path3.sep)) throw new Error("Invalid recording path");
      const stat = await fs5.promises.stat(filePath);
      if (!stat.isFile() || stat.size !== req.body.length || stat.size > MAX_RECORDING_SIZE) throw new Error("Recording identity mismatch");
      const bytes = await fs5.promises.readFile(filePath);
      if (createHash7("sha256").update(bytes).digest("hex") !== createHash7("sha256").update(req.body).digest("hex")) throw new Error("Recording identity mismatch");
      stored = { filePath, fileSize: bytes.length };
    } else {
      stored = await storeRecording(tenantId2, callUuid3, req.body, "wav", Boolean(captureToken));
    }
    await query("UPDATE call_records SET recording_url = $1 WHERE call_uuid = $2 AND tenant_id = $3", [stored.filePath, callUuid3, tenantId2]);
    let analysisQueued = false;
    try {
      analysisQueued = await ingestStoredRecording(callUuid3, stored.filePath, typeof req.query.capture_token === "string" ? req.query.capture_token : "");
    } catch {
    }
    res.json({ ok: true, size: stored.fileSize, analysisQueued, ...captureToken ? { storageKey: stored.filePath } : {} });
  } catch {
    res.status(503).json({ error: "Recording storage is unavailable" });
  }
});
 const config=buildPgConfig();config.ssl={rejectUnauthorized:true,ca:binding.database.ca};config.options='-c search_path=pg_catalog,public,pg_temp';
 _pool=new pg.Pool(config);_pool.on('error',()=>{});
 const app=deps.express();app.disable('x-powered-by');let verified=false,server=null,started=false,closed=false,cleanupConfirmed=false,generation=0,listenAbort=null,listenTask=null,serverClosedTask=null,startupDone=Promise.resolve(),finishStartup=null;
 const rowFlags=(result,fields)=>result&&result.rows?.length===1&&Object.keys(result.rows[0]).length===fields.length&&fields.every(k=>result.rows[0][k]===true);
 const readinessQuery=(text,values)=>_pool.query({text,values,query_timeout:5000});
 const ensureOpen=ticket=>need(!closed&&(ticket===undefined||ticket===generation),'UPLOAD_RECEIVER_CANCELLED');
 async function verifyDatabase(ticket){
  ensureOpen(ticket);const identity=await readinessQuery(IDENTITY_SQL,[binding.database.role]);ensureOpen(ticket);
  need(rowFlags(identity,['exact','restricted','tls','no_memberships','no_ownership','no_db_create','no_schema_create']),'RESTRICTED_TLS_IDENTITY_REQUIRED');
  const pins=await readinessQuery(BINDING_SQL,[binding.database.name,binding.database.databaseOid,binding.database.roleOid,binding.database.serverVersion]);ensureOpen(ticket);
  need(rowFlags(pins,['database_name','database_oid','role_oid','server_version']),'DATABASE_BINDING_REQUIRED');
 }
 async function verifyStorageMetadata(ticket){
  ensureOpen(ticket);need(deps.process.geteuid()===binding.processIdentity.uid&&deps.process.getegid()===binding.processIdentity.gid,'PROCESS_IDENTITY_REQUIRED');
  const link=await fs5.promises.lstat(RECORDINGS_BASE);ensureOpen(ticket);
  const resolved=await fs5.promises.realpath(RECORDINGS_BASE);ensureOpen(ticket);
  const st=await fs5.promises.stat(RECORDINGS_BASE);ensureOpen(ticket);
  need(!link.isSymbolicLink()&&resolved===RECORDINGS_BASE&&st.isDirectory()&&st.uid===binding.storage.uid&&st.gid===binding.storage.gid&&(st.mode&0o777)===binding.storage.mode,'STORAGE_DIRECTORY_METADATA_REQUIRED');
 }
 app.get('/health',async(_req,res)=>{if(!verified){res.status(503).json({ok:false});return;}try{await verifyDatabase();res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 app.use('/api/recordings',storageRouter);
 async function start(){
  need(!started&&!closed,'RECEIVER_LIFECYCLE');started=true;const ticket=++generation;startupDone=new Promise(resolve=>{finishStartup=resolve;});
  try{
   await verifyDatabase(ticket);ensureOpen(ticket);await verifyStorageMetadata(ticket);ensureOpen(ticket);
   listenAbort=new AbortController();server=deps.http.createServer(app);
   serverClosedTask=new Promise(resolve=>server.once('close',resolve));
   listenTask=new Promise((resolve,reject)=>{
    server.once('error',reject);server.once('close',()=>reject(Error('UPLOAD_RECEIVER_CANCELLED')));
    server.once('listening',()=>{if(closed||ticket!==generation){listenAbort.abort();reject(Error('UPLOAD_RECEIVER_CANCELLED'));}else resolve();});
    server.listen({port:binding.port,host:binding.listenHost,signal:listenAbort.signal});
   });
   await listenTask;ensureOpen(ticket);verified=true;
   return{status:'UPLOAD_ONLY_RECEIVER_LISTENING',restrictedTlsIdentityVerified:true,storageDirectoryMetadataMatched:true,storageWriteAuthorizationProven:false,globalWorkersStarted:false};
  }catch{}finally{finishStartup();}
  const result=await close();throw Object.assign(Error('UPLOAD_RECEIVER_STARTUP_REFUSED'),{code:'UPLOAD_RECEIVER_STARTUP_REFUSED',cleanupConfirmed:result.cleanupConfirmed});
 }
 async function close(){
  if(closed)return{cleanupConfirmed};closed=true;generation++;verified=false;if(listenAbort)listenAbort.abort();
  const work=Promise.resolve().then(async()=>{
   await startupDone;
   if(listenTask)await listenTask.catch(()=>{});
   if(serverClosedTask)await serverClosedTask;
   await _pool.end();
  });
  cleanupConfirmed=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),2000);work.then(()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);});});
  return{cleanupConfirmed};
 }
 return{start,close,sourceBinding:SOURCE_BINDING};
}
module.exports={createUploadReceiver,sourceBinding:SOURCE_BINDING};
if(require.main===module)globalThis.console.log(JSON.stringify({status:'UNBOUND',hostIo:false,listening:false,productionBindingProvided:false}));
