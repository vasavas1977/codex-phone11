#!/usr/bin/env python3
"""Guarded one-time Phone11 plain-video admission schema operator."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence


SOURCE_BASE_SHA = "f5b47b8f3b9c09c3bdec05effd6ead5ad664a9e9"
ACTIVE_CONTAINER = "cp11-backend"
ACTIVE_CONTAINER_ID = "f9ce934dc51b531fe1a9b2bd927634322f9c6c572a551592a48d3e0d26a49616"
ACTIVE_IMAGE = "sha256:d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619"
EXPECTED_DATABASE_FINGERPRINT = "6901e1f28e6fc33ebba8eefaa8708e663f1145a22ccdeb5bdc960cd849b4a552"
EXPECTED_BEFORE_CATALOG_FINGERPRINT = "e8e40847c0622d3719b61e7447af883c3b45bc594ac6985c537cbafcdee7e0e3"
EXPECTED_TARGET_FINGERPRINT = "8719c1618a1212e13a414e2e717f394ce118660f5da0d3b618a4203bd9edd48c"
EXPECTED_ARTIFACT_SHA256 = "985437663523803627abd151b5ee3a1858f65b61966c051ec6fbd048a0a4f732"
EXPECTED_OWNER = "phone11ai"
RECEIPT_SCHEMA = "phone11-migration-receipt/v1"
MAX_BYTES = 256 * 1024

PREREQUISITES = ["users", "tenants", "tenant_memberships", "phone11_auth_identity"]
TARGETS = [
    "phone11_plain_video_admission_rooms",
    "phone11_plain_video_admission_members",
    "phone11_plain_video_admission_leases",
    "phone11_plain_video_eviction_operations",
]


class MigrationError(RuntimeError):
    def __init__(self, stage: str) -> None:
        super().__init__(stage)
        self.stage = stage


def require(value: bool, stage: str) -> None:
    if not value:
        raise MigrationError(stage)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def secure_read(path: Path, uid: int = 0, gid: int = 0) -> bytes:
    try:
        before = path.lstat()
        require(
            stat.S_ISREG(before.st_mode)
            and not stat.S_ISLNK(before.st_mode)
            and before.st_uid == uid
            and before.st_gid == gid
            and before.st_nlink == 1
            and stat.S_IMODE(before.st_mode) == 0o600
            and before.st_size <= MAX_BYTES,
            "artifact",
        )
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(descriptor)
            require(
                (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid)
                == (before.st_dev, before.st_ino, before.st_uid, before.st_gid),
                "artifact",
            )
            raw = b""
            while len(raw) <= MAX_BYTES:
                chunk = os.read(descriptor, min(65_536, MAX_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw += chunk
            require(len(raw) <= MAX_BYTES and os.fstat(descriptor).st_size == len(raw), "artifact")
            return raw
        finally:
            os.close(descriptor)
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("artifact") from error


def inspect_container() -> None:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", ACTIVE_CONTAINER],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        require(result.returncode == 0 and len(result.stdout) <= MAX_BYTES, "container")
        document = json.loads(result.stdout)
        require(isinstance(document, list) and len(document) == 1, "container")
        current = document[0]
        require(isinstance(current, Mapping), "container")
        state = current.get("State")
        require(isinstance(state, Mapping), "container")
        require(
            current.get("Id") == ACTIVE_CONTAINER_ID
            and current.get("Image") == ACTIVE_IMAGE
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy",
            "container",
        )
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise MigrationError("container") from error


NODE_PROGRAM = r"""
const fs=require('node:fs'),crypto=require('node:crypto'),pg=require('pg');
const action=process.argv[1],contract=JSON.parse(process.argv[2]);
const prereqs=contract.prerequisites,targets=contract.targets,names=[...prereqs,...targets];
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v)}
const sha=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const first=(...keys)=>{for(const key of keys)if(process.env[key])return process.env[key]};
function config(){const d={host:first('PG_HOST','DB_HOST','POSTGRES_HOST'),port:first('PG_PORT','DB_PORT','POSTGRES_PORT'),user:first('PG_USER','DB_USER','POSTGRES_USER'),password:first('PG_PASSWORD','DB_PASSWORD','POSTGRES_PASSWORD'),database:first('PG_DATABASE','DB_NAME','DB_DATABASE','POSTGRES_DB')};const complete=d.host&&d.user&&d.password&&d.database,cs=process.env.PG_CONNECTION_STRING||(!complete?process.env.DATABASE_URL:undefined),mode=(first('PG_SSL','DB_SSL','POSTGRES_SSL','DATABASE_SSL')||'').toLowerCase(),ssl=mode==='false'||mode==='0'||mode==='disable'||(cs||'').includes('sslmode=disable')?false:{rejectUnauthorized:first('PG_SSL_REJECT_UNAUTHORIZED','DB_SSL_REJECT_UNAUTHORIZED')==='true'};return cs?{connectionString:cs,ssl,connectionTimeoutMillis:5000}:{...d,port:Number(d.port||5432),ssl,connectionTimeoutMillis:5000}}
async function identity(c){return(await c.query("SELECT current_database() db,current_user usr,current_setting('server_version_num') version_num,inet_server_addr()::text addr,inet_server_port() port,(SELECT oid FROM pg_database WHERE datname=current_database()) db_oid")).rows[0]}
async function catalog(c){
 const relations=(await c.query("SELECT c.relname name,c.relkind,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[names])).rows;
 const columns=(await c.query("SELECT c.relname table_name,a.attnum ordinal,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,pg_get_expr(ad.adbin,ad.adrelid) default_expr FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",[names])).rows;
 const constraints=(await c.query("SELECT c.relname table_name,con.conname name,con.contype type,con.convalidated validated,con.condeferrable deferrable,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,con.conname",[names])).rows;
 const indexes=(await c.query("SELECT tablename table_name,indexname name,indexdef definition FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname",[names])).rows;
 const grants=(await c.query("SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,grantee,privilege_type",[names])).rows;
 const policies=(await c.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname",[names])).rows;
 return{relations,columns,constraints,indexes,grants,policies};
}
async function extras(c){
 const routines=(await c.query("SELECT p.proname name,pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,p.provolatile volatility,p.prokind kind,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,l.lanname language,pg_get_functiondef(p.oid) definition,p.proconfig settings,coalesce(p.proacl::text,'') acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname='phone11_plain_video_admission_touch_revision' ORDER BY p.proname")).rows;
 const triggers=(await c.query("SELECT c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY c.relname,t.tgname",[['phone11_plain_video_admission_room_revision','phone11_plain_video_admission_member_revision']])).rows;
 return{routines,triggers};
}
function withoutTargets(value){const set=new Set(targets),out={};for(const section of ['relations','columns','constraints','indexes','grants'])out[section]=value[section].filter(row=>!set.has(section==='relations'?row.name:row.table_name));out.policies=value.policies.filter(row=>!set.has(row.tablename));return out}
function onlyTargets(value,extra){const set=new Set(targets),out={};for(const section of ['relations','columns','constraints','indexes','grants'])out[section]=value[section].filter(row=>set.has(section==='relations'?row.name:row.table_name));out.policies=value.policies.filter(row=>set.has(row.tablename));return{...out,...extra}}
function verify(before,after,extra){if(sha(before)!==contract.before_catalog_fingerprint||canonical(withoutTargets(before))!==canonical(withoutTargets(after)))throw Error('drift');const target=onlyTargets(after,extra);if(sha(target)!==contract.target_fingerprint)throw Error('target');return{target_fingerprint:sha(target),after_catalog_fingerprint:sha(after),verification_sha256:sha({source_base_sha:contract.source_base_sha,artifact_sha256:contract.artifact_sha256,database_fingerprint:contract.database_fingerprint,before_catalog_fingerprint:contract.before_catalog_fingerprint,target_fingerprint:contract.target_fingerprint,after_catalog_fingerprint:sha(after)})}}
(async()=>{const c=new pg.Client(config());try{if(!['prepare','apply','recover'].includes(action))throw Error('mode');await c.connect();await c.query(action==='apply'?'BEGIN':'BEGIN TRANSACTION READ ONLY');await c.query("SET LOCAL statement_timeout='30000ms'");await c.query("SET LOCAL lock_timeout='2000ms'");if(action==='apply')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('phone11-plain-video-admission-live-delta-20260920',0))");const id=await identity(c),before=await catalog(c);if(sha(id)!==contract.database_fingerprint||(action!=='recover'&&sha(before)!==contract.before_catalog_fingerprint))throw Error('pin');if(action==='prepare'){await c.query('ROLLBACK');console.log(JSON.stringify({ok:true,action,identity_fingerprint:sha(id),catalog_fingerprint:sha(before)}));return}if(action==='recover'){const extra=await extras(c),base=withoutTargets(before),proof=verify(base,before,extra);await c.query('ROLLBACK');console.log(JSON.stringify({ok:true,action,identity_fingerprint:sha(id),catalog:before,extra,proof}));return}await c.query(fs.readFileSync(0,'utf8'));const afterId=await identity(c),after=await catalog(c),extra=await extras(c);if(sha(afterId)!==contract.database_fingerprint)throw Error('identity');const proof=verify(before,after,extra);await c.query('COMMIT');console.log(JSON.stringify({ok:true,action,identity_fingerprint:sha(afterId),before_catalog:before,after_catalog:after,extra,proof}));}catch(e){try{await c.query('ROLLBACK')}catch{}console.log(JSON.stringify({ok:false,error:'MIGRATION_BLOCKED'}));process.exitCode=1}finally{await c.end().catch(()=>{})}})();
"""


def contract() -> dict[str, Any]:
    return {
        "source_base_sha": SOURCE_BASE_SHA,
        "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
        "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
        "before_catalog_fingerprint": EXPECTED_BEFORE_CATALOG_FINGERPRINT,
        "target_fingerprint": EXPECTED_TARGET_FINGERPRINT,
        "prerequisites": PREREQUISITES,
        "targets": TARGETS,
    }


def run_database(action: str, sql: bytes = b"") -> Mapping[str, Any]:
    require(action in {"prepare", "apply", "recover"}, "database")
    try:
        result = subprocess.run(
            [
                "/usr/bin/docker", "exec", "-i", ACTIVE_CONTAINER, "node", "-e",
                NODE_PROGRAM, action, json.dumps(contract(), sort_keys=True, separators=(",", ":")),
            ],
            input=sql,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=90,
            check=False,
        )
        require(result.returncode == 0 and 0 < len(result.stdout) <= 2 * 1024 * 1024, "database")
        document = json.loads(result.stdout)
        require(isinstance(document, Mapping) and document.get("ok") is True, "database")
        return document
    except MigrationError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise MigrationError("database") from error


def verification_from(document: Mapping[str, Any]) -> str:
    proof = document.get("proof")
    require(isinstance(proof, Mapping), "verification")
    require(
        proof.get("target_fingerprint") == EXPECTED_TARGET_FINGERPRINT
        and isinstance(proof.get("after_catalog_fingerprint"), str)
        and isinstance(proof.get("verification_sha256"), str),
        "verification",
    )
    return str(proof["verification_sha256"])


def receipt_bytes(verification: str) -> bytes:
    return canonical_bytes(
        {
            "schema": RECEIPT_SCHEMA,
            "status": "applied",
            "artifact_sha256": EXPECTED_ARTIFACT_SHA256,
            "database_fingerprint": EXPECTED_DATABASE_FINGERPRINT,
            "verification_sha256": verification,
        },
    )


def write_receipt(path: Path, verification: str, uid: int = 0, gid: int = 0) -> None:
    require(path.is_absolute(), "receipt")
    descriptor: int | None = None
    temporary: str | None = None
    try:
        parent = path.parent.lstat()
        require(
            stat.S_ISDIR(parent.st_mode)
            and not stat.S_ISLNK(parent.st_mode)
            and parent.st_uid == uid
            and parent.st_gid == gid
            and stat.S_IMODE(parent.st_mode) == 0o700
            and not os.path.lexists(path),
            "receipt",
        )
        raw = receipt_bytes(verification)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, uid, gid)
        view = memoryview(raw)
        while view:
            written = os.write(descriptor, view)
            require(written > 0, "receipt")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.link(temporary, path, follow_symlinks=False)
        os.unlink(temporary)
        temporary = None
        require(secure_read(path, uid, gid) == raw, "receipt")
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except MigrationError:
        raise
    except OSError as error:
        raise MigrationError("receipt") from error
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--recover-receipt", action="store_true")
    parser.add_argument("--sql", required=True, type=Path)
    parser.add_argument("--receipt", type=Path)
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace) -> int:
    try:
        require(os.geteuid() == 0, "root")
        sql = secure_read(arguments.sql)
        require(sha256(sql) == EXPECTED_ARTIFACT_SHA256, "artifact")
        require(EXPECTED_TARGET_FINGERPRINT != "REPLACE_AFTER_REAL_POSTGRES_REHEARSAL", "artifact")
        inspect_container()
        if arguments.prepare:
            require(arguments.receipt is None, "arguments")
            document = run_database("prepare")
            require(
                document.get("identity_fingerprint") == EXPECTED_DATABASE_FINGERPRINT
                and document.get("catalog_fingerprint") == EXPECTED_BEFORE_CATALOG_FINGERPRINT,
                "verification",
            )
            print("migration=PREPARE_READY apply=NOT_RUN")
            return 0
        require(arguments.receipt is not None, "arguments")
        if arguments.recover_receipt:
            document = run_database("recover")
            verification = verification_from(document)
            if os.path.lexists(arguments.receipt):
                require(secure_read(arguments.receipt) == receipt_bytes(verification), "receipt")
                print("migration=ALREADY_APPLIED receipt=ALREADY_PRESENT")
                return 0
            write_receipt(arguments.receipt, verification)
            print("migration=ALREADY_APPLIED receipt=RECOVERED")
            return 0
        require(not os.path.lexists(arguments.receipt), "receipt")
        verification = verification_from(run_database("apply", sql))
        write_receipt(arguments.receipt, verification)
        print("migration=APPLIED receipt=WRITTEN")
        return 0
    except MigrationError as error:
        print("migration=BLOCKED stage=" + error.stage)
        return 1
    except (KeyboardInterrupt, OSError):
        print("migration=BLOCKED stage=operator")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args(sys.argv[1:])))
