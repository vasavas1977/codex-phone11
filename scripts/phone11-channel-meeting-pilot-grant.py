#!/usr/bin/env python3
"""Grant Phone11 meeting-start permission to the two approved pilot members only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
from typing import Any, Mapping, Sequence


CONTAINER_ID = "e927176b48887d62d7ebdcb934b60366f6e41ca2951df8a47d784fbca57b12b6"
CONTAINER_NAME = "cp11-api-candidate-settings"
IMAGE = "sha256:2669c5032ebda82381c2e1c947cbd804132457355bb05931f1e921d064f1c8a9"
SOURCE_SHA = "9804c2f09f99453747e0bb54e23d3b6149f5b5cb"
BUNDLE_SHA256 = "20e717154637803d1205498c994ebcb22028fdc4ec71095fcc21737507501121"
LOCK_SHA256 = "24a72aa60f0b43fe3afdad41f2e0f0f348f75ac065172627913fe72d43f2c801"
MIGRATION_RECEIPT = Path("/var/lib/phone11-channel-meetings/receipt.json")
MIGRATION_REHEARSAL = Path(
    "/opt/phone11ai/channel-meetings-release/9aab162/"
    "migration-rehearsal-20260922T181434Z"
)
MIGRATION_MANIFEST_SHA256 = "7a5ae0b2edf7145db03d4ae024b53b7486bbca5190c7dd445c007a72d8838680"
MIGRATION_SQL_SHA256 = "bf8ee65e6c05c396d6a469e175176e410463601ce9f88ff378587cbc1e1302e9"
MIGRATION_RECEIPT_SHA256 = "485872cba4ba67bd5c2433d2f7f52ac402f7269dcf6a965244206674d1384277"
MIGRATION_OPERATOR_SHA256 = "b4df03b21a290a573e64df64b38795d254ccee5249e569ffcfbad05d39b0b6c0"
DATABASE_IDENTITY_SHA256 = "4a7172827511ecb9430342de97d66a94b704c67d5d705147e3d42febb6c28fbe"
BEFORE_CATALOG_SHA256 = "5834b0714d9229bf4a7cb7dc72b41635eb96401db55df05597c8a764a85a4936"
AFTER_CATALOG_SHA256 = "852282b3c15b55ff698b88744196235a4e464e946f0fd3fa182cc1a10d95a3a5"
BACKUP_PROOF_SHA256 = "7d022842b6f15bbb91d7d0fe5b3754b5786e5b877911984b19e364db5a698b3e"
RESTORE_PROOF_SHA256 = "81b0c0f85878b5807c446570e6cba2ebdddaae0209fed1d1211b0618ee6e6e4a"
VERIFICATION_SHA256 = "c5c1618afba7413bd773f08dd2884dbbbb91b81f3e8a2b6beae65922ac7ec2b0"
TENANT_ID = 1
CHANNEL_ID = "24ee4d70-8f57-4192-982c-badb88b8930a"
APPROVED = {1: "3001", 2: "1020"}


class GrantError(RuntimeError):
    pass


def guarded(condition: bool) -> None:
    if not condition:
        raise GrantError()


def secure_json(path: Path) -> tuple[Mapping[str, Any], str]:
    descriptor: int | None = None
    try:
        before = path.lstat()
        guarded(
            stat.S_ISREG(before.st_mode)
            and not stat.S_ISLNK(before.st_mode)
            and before.st_uid == 0
            and before.st_gid == 0
            and stat.S_IMODE(before.st_mode) == 0o600
            and before.st_nlink == 1
            and 0 < before.st_size <= 64 * 1024
        )
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        guarded(
            (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_size)
            == (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_size)
        )
        raw = os.read(descriptor, 64 * 1024 + 1)
        guarded(len(raw) == before.st_size)
        value = json.loads(raw)
        guarded(isinstance(value, Mapping))
        return value, hashlib.sha256(raw).hexdigest()
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GrantError() from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def validate_receipt(receipt: Mapping[str, Any], receipt_sha256: str) -> None:
    guarded(
        receipt_sha256 == MIGRATION_RECEIPT_SHA256
        and set(receipt) == {
            "schema", "manifest_sha256", "sql_sha256", "database_identity_sha256",
            "before_catalog_sha256", "after_catalog_sha256", "container_id", "image",
            "source_sha", "bundle_sha256", "lock_sha256", "backup_proof_sha256",
            "restore_proof_sha256", "status", "verification_sha256",
        }
        and receipt.get("schema") == "phone11.channel-meetings-migration-journal/v1"
        and receipt.get("status") == "applied"
        and receipt.get("manifest_sha256") == MIGRATION_MANIFEST_SHA256
        and receipt.get("sql_sha256") == MIGRATION_SQL_SHA256
        and receipt.get("database_identity_sha256") == DATABASE_IDENTITY_SHA256
        and receipt.get("before_catalog_sha256") == BEFORE_CATALOG_SHA256
        and receipt.get("after_catalog_sha256") == AFTER_CATALOG_SHA256
        and receipt.get("container_id") == CONTAINER_ID
        and receipt.get("image") == IMAGE
        and receipt.get("source_sha") == SOURCE_SHA
        and receipt.get("bundle_sha256") == BUNDLE_SHA256
        and receipt.get("lock_sha256") == LOCK_SHA256
        and receipt.get("backup_proof_sha256") == BACKUP_PROOF_SHA256
        and receipt.get("restore_proof_sha256") == RESTORE_PROOF_SHA256
        and receipt.get("verification_sha256") == VERIFICATION_SHA256
    )


def validate_container() -> None:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", "inspect", CONTAINER_ID],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= 128 * 1024)
        rows = json.loads(result.stdout)
        guarded(isinstance(rows, list) and len(rows) == 1)
        container = rows[0]
        labels = container.get("Config", {}).get("Labels", {})
        state = container.get("State", {})
        binding = container.get("HostConfig", {}).get("PortBindings", {}).get("3005/tcp")
        guarded(
            container.get("Id") == CONTAINER_ID
            and container.get("Name") == "/" + CONTAINER_NAME
            and container.get("Image") == IMAGE
            and state.get("Running") is True
            and state.get("Health", {}).get("Status") == "healthy"
            and labels.get("com.phone11.source-sha") == SOURCE_SHA
            and labels.get("com.phone11.bundle-sha256") == BUNDLE_SHA256
            and labels.get("com.phone11.lock-sha256") == LOCK_SHA256
            and binding == [{"HostIp": "127.0.0.1", "HostPort": "3005"}]
        )
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, AttributeError) as error:
        raise GrantError() from error


def validate_live_migration() -> None:
    """Recompute the exact database identity and applied catalog through the reviewed operator."""

    descriptor: int | None = None
    try:
        operator = MIGRATION_REHEARSAL / "phone11-channel-meetings-migrate.py"
        before = operator.lstat()
        guarded(
            stat.S_ISREG(before.st_mode)
            and not stat.S_ISLNK(before.st_mode)
            and before.st_uid == 0
            and before.st_gid == 0
            and stat.S_IMODE(before.st_mode) == 0o600
            and before.st_nlink == 1
            and 0 < before.st_size <= 512 * 1024
        )
        descriptor = os.open(operator, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        guarded(
            (opened.st_dev, opened.st_ino, opened.st_uid, opened.st_gid, opened.st_size)
            == (before.st_dev, before.st_ino, before.st_uid, before.st_gid, before.st_size)
        )
        operator_bytes = os.read(descriptor, 512 * 1024 + 1)
        guarded(
            len(operator_bytes) == before.st_size
            and hashlib.sha256(operator_bytes).hexdigest() == MIGRATION_OPERATOR_SHA256
        )
        os.lseek(descriptor, 0, os.SEEK_SET)
        result = subprocess.run(
            [
                "/usr/bin/python3",
                f"/proc/self/fd/{descriptor}",
                "--recover",
                "--manifest", str(MIGRATION_REHEARSAL / "migration-manifest.json"),
                "--sql", str(MIGRATION_REHEARSAL / "channel-meeting-migration.sql"),
                "--backup-proof", str(MIGRATION_REHEARSAL / "backup-proof.json"),
                "--restore-proof", str(MIGRATION_REHEARSAL / "restore-proof.json"),
                "--receipt", str(MIGRATION_RECEIPT),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=45,
            check=False,
            pass_fds=(descriptor,),
        )
        guarded(
            result.returncode == 0
            and result.stdout == b"channel_meetings=RECOVERY_VALID status=APPLIED\n"
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GrantError() from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


NODE_PROGRAM = r'''
const crypto = require("node:crypto");
const pg = require("pg");
const mode = process.argv[1];
const tenantId = 1;
const channelId = "24ee4d70-8f57-4192-982c-badb88b8930a";
const approved = [{userId:1,extension:"3001"},{userId:2,extension:"1020"}];
const expectedIdentity = "4a7172827511ecb9430342de97d66a94b704c67d5d705147e3d42febb6c28fbe";
const expectedCatalog = "852282b3c15b55ff698b88744196235a4e464e946f0fd3fa182cc1a10d95a3a5";
function first(...keys) { for (const key of keys) if (process.env[key]) return process.env[key]; }
function config() {
  const discrete={host:first("PG_HOST","DB_HOST","POSTGRES_HOST"),port:first("PG_PORT","DB_PORT","POSTGRES_PORT"),user:first("PG_USER","DB_USER","POSTGRES_USER"),password:first("PG_PASSWORD","DB_PASSWORD","POSTGRES_PASSWORD"),database:first("PG_DATABASE","DB_NAME","DB_DATABASE","POSTGRES_DB")};
  const complete=[discrete.host,discrete.user,discrete.password,discrete.database].every(Boolean);
  const connectionString=process.env.PG_CONNECTION_STRING ?? (complete ? undefined : process.env.DATABASE_URL);
  const sslMode=first("PG_SSL","DB_SSL","POSTGRES_SSL","DATABASE_SSL")?.toLowerCase();
  const ssl=sslMode==="false"||sslMode==="0"||sslMode==="disable"||connectionString?.includes("sslmode=disable") ? false : {rejectUnauthorized:first("PG_SSL_REJECT_UNAUTHORIZED","DB_SSL_REJECT_UNAUTHORIZED")==="true"};
  if (!connectionString && !complete) throw new Error("configuration");
  return connectionString ? {connectionString,ssl,max:1,connectionTimeoutMillis:5000} : {...discrete,port:parseInt(discrete.port??"5432",10),ssl,max:1,connectionTimeoutMillis:5000};
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
async function identity(client) {
  return (await client.query("SELECT current_database() database,current_schema() schema,current_setting('server_version_num') server_version_num,(SELECT oid::text FROM pg_database WHERE datname=current_database()) database_oid")).rows[0];
}
async function catalog(client) {
  const relations=(await client.query("SELECT n.nspname schema,c.relname name,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname,c.relname")).rows;
  const columns=(await client.query("SELECT n.nspname schema,c.relname table_name,a.attname name,pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attidentity identity,a.attgenerated generated,pg_get_expr(d.adbin,d.adrelid,true) default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum")).rows;
  const constraints=(await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,con.convalidated validated,pg_get_constraintdef(con.oid,true) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY n.nspname,c.relname,con.conname")).rows;
  const indexes=(await client.query("SELECT ns.nspname schema,t.relname table_name,i.relname name,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace WHERE ns.nspname='public' ORDER BY ns.nspname,t.relname,i.relname")).rows;
  const triggers=(await client.query("SELECT n.nspname schema,c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname")).rows;
  const functions=(await client.query("SELECT n.nspname schema,p.proname name,p.prokind kind,pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,l.lanname language,p.provolatile volatility,p.prosecdef security_definer,CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY n.nspname,p.proname,arguments")).rows;
  return {relations,columns,constraints,indexes,triggers,functions};
}
async function exactDatabase(client) {
  if(sha(await identity(client))!==expectedIdentity || sha(await catalog(client))!==expectedCatalog) throw new Error("database");
}
function exactUsers(rows) {
  const actual=[...new Set(rows.map(row=>Number(row.user_id)))].sort((a,b)=>a-b);
  return actual.length===2 && actual[0]===1 && actual[1]===2;
}
function approvedState(rows, expected) {
  const selected=rows.filter(row=>Number(row.user_id)===1||Number(row.user_id)===2);
  return selected.length===2 && exactUsers(selected)
    && selected.every(row=>row.can_start_meeting===expected)
    && rows.every(row=>(Number(row.user_id)===1||Number(row.user_id)===2)||row.can_start_meeting===false);
}
async function eligibility(client, lock) {
  const suffix=lock ? " FOR UPDATE OF conversation,tenant" : "";
  const channel=await client.query(`SELECT conversation.id FROM phone11_chat_conversations conversation JOIN tenants tenant ON tenant.id=conversation.tenant_id AND tenant.status='active' WHERE conversation.tenant_id=$1 AND conversation.id=$2 AND conversation.kind='channel'${suffix}`,[tenantId,channelId]);
  if(channel.rows.length!==1) throw new Error("channel");
  const memberLock=lock ? " FOR UPDATE OF member" : "";
  const members=await client.query(`SELECT member.user_id,member.can_start_meeting FROM phone11_chat_members member WHERE member.tenant_id=$1 AND member.conversation_id=$2 ORDER BY member.user_id${memberLock}`,[tenantId,channelId]);
  if(!approvedState(members.rows,false) && !approvedState(members.rows,true)) throw new Error("members");
  const membershipLock=lock ? " FOR UPDATE OF membership" : "";
  const memberships=await client.query(`SELECT membership.user_id FROM tenant_memberships membership WHERE membership.tenant_id=$1 AND membership.user_id=ANY($2::integer[]) AND membership.status='active' ORDER BY membership.user_id${membershipLock}`,[tenantId,[1,2]]);
  if(!exactUsers(memberships.rows)) throw new Error("memberships");
  const identityLock=lock ? " FOR UPDATE OF identity" : "";
  const identities=await client.query(`SELECT identity.legacy_user_id user_id FROM phone11_auth_identity identity WHERE identity.legacy_user_id=ANY($1::integer[]) AND identity.disabled_at IS NULL ORDER BY identity.legacy_user_id${identityLock}`,[[1,2]]);
  if(!exactUsers(identities.rows)) throw new Error("identities");
  const extensionLock=lock ? " FOR UPDATE OF assignment,extension" : "";
  const extensions=await client.query(`SELECT desired.user_id FROM (VALUES (1,'3001'::text),(2,'1020'::text)) desired(user_id,extension_number) JOIN user_extensions assignment ON assignment.user_id=desired.user_id JOIN extensions extension ON extension.id=assignment.extension_id AND extension.tenant_id=$1 AND extension.extension_number=desired.extension_number AND extension.status='active' AND extension.deleted_at IS NULL ORDER BY desired.user_id${extensionLock}`,[tenantId]);
  if(!exactUsers(extensions.rows) || extensions.rows.length!==2) throw new Error("extensions");
  return members.rows;
}
(async()=>{
  if(!["prepare","apply","verify"].includes(mode)) throw new Error("mode");
  const pool=new pg.Pool(config()); let client;
  try {
    client=await pool.connect();
    await client.query(mode==="prepare" ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    await exactDatabase(client);
    const installed=(await client.query("SELECT to_regclass('public.phone11_channel_meetings') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='phone11_chat_members' AND column_name='can_start_meeting') available")).rows[0]?.available;
    if(installed!==true) throw new Error("schema");
    if(mode==="prepare") {
      const members=await eligibility(client,false);
      if(!approvedState(members,false)) throw new Error("permission_state");
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({status:"PREPARE_READY"}));
      return;
    }
    if(mode==="verify") {
      const locked=(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",[`phone11-channel-meeting:${tenantId}:${channelId}`])).rows[0]?.locked;
      if(locked!==true) {
        await client.query("ROLLBACK");
        process.stdout.write(JSON.stringify({status:"PENDING"}));
        return;
      }
      const members=await eligibility(client,true);
      if(!approvedState(members,true)) {
        await client.query("ROLLBACK");
        process.stdout.write(JSON.stringify({status:"PENDING"}));
        return;
      }
      await client.query("ROLLBACK");
      process.stdout.write(JSON.stringify({status:"VERIFIED",users:[1,2]}));
      return;
    }
    const locked=(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",[`phone11-channel-meeting:${tenantId}:${channelId}`])).rows[0]?.locked;
    if(locked!==true) throw new Error("advisory_lock");
    const before=await eligibility(client,true);
    if(!approvedState(before,false)) throw new Error("permission_state");
    const changed=await client.query("UPDATE phone11_chat_members SET can_start_meeting=TRUE WHERE tenant_id=$1 AND conversation_id=$2 AND user_id=ANY($3::integer[]) AND can_start_meeting=FALSE RETURNING user_id",[tenantId,channelId,[1,2]]);
    if(changed.rows.length!==2 || !exactUsers(changed.rows)) throw new Error("rowcount");
    const after=await eligibility(client,false);
    if(!approvedState(after,true)) throw new Error("postcondition");
    await client.query("COMMIT");
    process.stdout.write(JSON.stringify({status:"APPLIED",users:[1,2]}));
  } catch (_error) {
    try { if(client) await client.query("ROLLBACK"); } catch (_ignored) {}
    process.exitCode=1;
  } finally { client?.release(); await pool.end().catch(()=>undefined); }
})();
'''


def execute(mode: str) -> Mapping[str, Any]:
    try:
        result = subprocess.run(
            [
                "/usr/bin/docker", "exec", "--interactive", "--workdir", "/app",
                CONTAINER_ID, "node", "-e", NODE_PROGRAM, mode,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=30,
            check=False,
        )
        guarded(result.returncode == 0 and 0 < len(result.stdout) <= 4096)
        value = json.loads(result.stdout)
        guarded(isinstance(value, Mapping))
        return value
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise GrantError() from error


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--verify", action="store_true")
    return parser.parse_args(argv)


def run(arguments: argparse.Namespace) -> int:
    try:
        guarded(os.geteuid() == 0)
        receipt, receipt_sha256 = secure_json(MIGRATION_RECEIPT)
        validate_receipt(receipt, receipt_sha256)
        validate_container()
        validate_live_migration()
        mode = "prepare" if arguments.prepare else "verify" if arguments.verify else "apply"
        result = execute(mode)
        if mode == "prepare":
            guarded(result == {"status": "PREPARE_READY"})
            print("pilot_grant=PREPARE_READY status=NOT_GRANTED")
        elif mode == "apply":
            guarded(result == {"status": "APPLIED", "users": [1, 2]})
            print("pilot_grant=APPLIED users=1,2")
        else:
            if result == {"status": "VERIFIED", "users": [1, 2]}:
                print("pilot_grant=VERIFIED users=1,2")
            else:
                guarded(result == {"status": "PENDING"})
                print("pilot_grant=PENDING")
                return 1
        return 0
    except GrantError:
        print("pilot_grant=BLOCKED")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
