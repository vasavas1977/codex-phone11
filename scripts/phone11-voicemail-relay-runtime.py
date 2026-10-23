#!/usr/bin/env python3
"""Pinned relay supervisor. --check reads metadata; --run processes queued audio.

This is independent of the historical candidate-start operator and has no
backend-name default. A protected, separately reviewed commissioning packet
must supply the current runtime and bundle pins. It grants no staging authority.
"""
from __future__ import annotations

import argparse
from collections import namedtuple
import ipaddress
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

SCHEMA = "phone11-voicemail-relay-runtime/v1"
ARTIFACT_PATHS = {
    "phone11_legacy_voicemail.lua": "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua",
    "phone11_voicemail_deposit.lua": "/etc/freeswitch/scripts/phone11_voicemail_deposit.lua",
    "runner.sh": "/opt/phone11ai/voicemail/runner.sh",
    "producer.mjs": "/opt/phone11ai/voicemail/producer.mjs",
    "relay.mjs": "/opt/phone11ai/voicemail/relay.mjs",
}
TRUSTED_SCHEMA = "phone11-voicemail-relay-runtime/v2"
TRUSTED_LANE = "trusted-local-fallback-owner-epoch/v1"
TRUSTED_ARTIFACT_PATHS = dict(ARTIFACT_PATHS, **{
    "phone11_voicemail_local_fallback.lua": "/etc/freeswitch/scripts/phone11_voicemail_local_fallback.lua",
    "local-fallback-ingress.mjs": "/opt/phone11ai/voicemail/local-fallback-ingress.mjs",
})
# Reviewed source-bound protocol release, not arbitrary caller-supplied hashes.
# A new release requires a new independently reviewed protocol pin set.
TRUSTED_ARTIFACTS = {
    "phone11_legacy_voicemail.lua": "6883384f279e1e8876f8b312c8783b3101c18b65d190275fbb870c0bba6dcfad",
    "phone11_voicemail_deposit.lua": "9552b2c6692c70387fec4eb6f3b13487e2f0f2b69c713a928294670dd86a629b",
    "runner.sh": "e94a4b40fb89e5c52d852f666917de4f5319daaa138901e9d509b3f7850fd38c",
    "producer.mjs": "7c24440d2a3f978be1875dbb13909a23267545845e4cd2c09c0d734fb784502f",
    "relay.mjs": "6f4ee65705212fd5569d977e34e9458bc3086705b88b5c861a70936a978daf5c",
    "phone11_voicemail_local_fallback.lua": "f5e876ee0505170b19f59d0480c9f768f476b1c9ff0356e1373bdd9d250aa6d0",
    "local-fallback-ingress.mjs": "301b0cf779f279e7c3c1b2f7420484459b847e854c09e4cf7d7543ca6b552575",
}
TRUSTED_SOURCE_INPUTS = {
    "producer": "4e8e228ac5866641d2572175216f54e97f92468b67dcc72140cc0c1de0e8fc7a",
    "ingress": "3b82b1e2ecad495ea507f16a99e2211233ed183711d69b8f2a6146118d411785",
    "fallbackLua": TRUSTED_ARTIFACTS["phone11_voicemail_local_fallback.lua"],
    "backendStorage": "053412f0f89e35d00144f31729a5fd27424431a1ea4ac5fd1415aafbdfdc6de6",
}
TRUSTED_NATIVE_SOURCE_BASE = "34a2ea092f8ff21c7e649dd26176109b1929ee3d"
TRUSTED_BUNDLE_MANIFEST = "177ea04054d5b46784b6551dd90d456bdf208e30601ccefbe4548b2dbc8fa29b"
TRUSTED_BACKEND_BUNDLE = "e1c270e67b1f6d4bc3ed484a74a90c3143cc3b6ddb8db5698208173988c60e5b"
TRUSTED_DERIVATIVE_MANIFEST = "d5dd86c723b2db9bce4b567501552b39c57622c5cc863a1ff462e2052d714dc8"
TRUSTED_ADMISSION_PATH = "/api/recordings/voicemail/admission/idempotent/owner-epoch"
TRUSTED_PATCH_COMMIT = "019beb3e62f8bc3a56dcc6cf899aedc1a9c625fc"
TRUSTED_SCHEMA_FIX_COMMIT = "d759507aa919d1ebd9323533cb4bafc5711b756e"
TRUSTED_BACKEND_SOURCES = {
    "server/invitations/service.ts": {
        "baseSha256": "93735b14d39e1df0a9206cdfee825b4171be35246743b5e482278b15ed36213f",
        "bytes": 20670,
        "commit": "d759507aa919d1ebd9323533cb4bafc5711b756e",
        "sha256": "80632aa28a2d9f62176b15d0e839693569eea003cfcba1407f7d7b23c1f89232"
    },
    "server/pbx/database-readiness.ts": {
        "baseSha256": "0291f6b81e38089ec0b2d315081f71b56d358757115d1fb8eacff6278b4544a8",
        "bytes": 10193,
        "commit": "d759507aa919d1ebd9323533cb4bafc5711b756e",
        "sha256": "3668f204b3a7edef3221ddb0aaefe5612a720fd0388d84c5bad9df8e6cca33ee"
    },
    "server/pbx/recording-storage.ts": {
        "baseSha256": "42a918b390dfbce4677a6dc4ab77704ee98fc7b2d0888ada4b23141ede5f74b5",
        "bytes": 31899,
        "commit": "019beb3e62f8bc3a56dcc6cf899aedc1a9c625fc",
        "sha256": "053412f0f89e35d00144f31729a5fd27424431a1ea4ac5fd1415aafbdfdc6de6"
    }
}
BASE_BACKEND_IMAGE = "sha256:ae8a13222d2bc9ee59db5e801aeb638c8f8a8a070062b11af044f8d849bcfd55"
SOURCE_ROOT = "/var/lib/freeswitch/voicemail"
OUTBOX_ROOT = "/var/lib/phone11-voicemail/outbox"
HASH = re.compile(r"[a-f0-9]{64}\Z")


class Refused(RuntimeError):
    pass


def require(ok, code):
    if not ok:
        raise Refused(code)


def exact(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys), "packet_shape")


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_key")
        result[key] = value
    return result


def identity(value):
    exact(value, {"name", "id", "image", "started"})
    require(isinstance(value["name"], str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", value["name"]), "container_name")
    require(isinstance(value["id"], str) and HASH.fullmatch(value["id"]), "container_id")
    require(isinstance(value["image"], str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value["image"]), "container_image")
    require(isinstance(value["started"], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z", value["started"]), "container_epoch")


def validate(packet):
    trusted = isinstance(packet, dict) and packet.get("schema") == TRUSTED_SCHEMA
    fields = {"schema", "sourceRevision", "bundleManifestSha256", "backend", "backendBundleSha256",
              "freeswitch", "artifacts", "uploadUrl", "runtimeUid", "runtimeGid", "hookReady"}
    exact(packet, fields | ({"lane", "protocolEvidence"} if trusted else set()))
    require(packet["schema"] in (SCHEMA, TRUSTED_SCHEMA), "packet_schema")
    require(isinstance(packet["sourceRevision"], str) and re.fullmatch(r"[a-f0-9]{40}", packet["sourceRevision"]), "source_revision")
    require(all(isinstance(packet[k], str) and HASH.fullmatch(packet[k]) for k in ("bundleManifestSha256", "backendBundleSha256")), "bundle_digest")
    identity(packet["backend"])
    identity(packet["freeswitch"])
    require(packet["freeswitch"]["name"] == "p11-freeswitch" and packet["freeswitch"]["id"] != packet["backend"]["id"], "runtime_mapping")
    exact(packet["artifacts"], TRUSTED_ARTIFACT_PATHS if trusted else ARTIFACT_PATHS)
    require(all(isinstance(v, str) and HASH.fullmatch(v) for v in packet["artifacts"].values()), "artifact_digest")
    # Native process was root in the accepted inventory. A different principal
    # needs a reviewed storage/reader model, rather than changing this assertion.
    require(type(packet["runtimeUid"]) is int and packet["runtimeUid"] == 0 and
            type(packet["runtimeGid"]) is int and packet["runtimeGid"] == 0, "native_identity")
    require(type(packet["hookReady"]) is bool, "hook_flag")
    require(isinstance(packet["uploadUrl"], str) and re.fullmatch(
        r"https://[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?/api/recordings/voicemail", packet["uploadUrl"]), "upload_url")
    if trusted:
        require(packet["lane"] == TRUSTED_LANE and packet["hookReady"] is False, "trusted_lane_protocol")
        require(packet["artifacts"] == TRUSTED_ARTIFACTS and packet["bundleManifestSha256"] == TRUSTED_BUNDLE_MANIFEST and
                packet["sourceRevision"] == TRUSTED_NATIVE_SOURCE_BASE,
                "trusted_native_release")
        require(packet["backendBundleSha256"] == TRUSTED_BACKEND_BUNDLE and
                packet["backend"]["image"] != BASE_BACKEND_IMAGE, "trusted_backend_release")
        exact(packet["protocolEvidence"], {"backendDerivative", "trustedIngress"})
        for evidence in packet["protocolEvidence"].values():
            exact(evidence, {"path", "sha256"})
            require(isinstance(evidence["path"], str) and Path(evidence["path"]).is_absolute() and
                    ".." not in Path(evidence["path"]).parts and isinstance(evidence["sha256"], str) and
                    HASH.fullmatch(evidence["sha256"]), "trusted_evidence_reference")
        require(packet["protocolEvidence"]["backendDerivative"]["sha256"] == TRUSTED_DERIVATIVE_MANIFEST,
                "trusted_derivative_source")


def read_document(path, uid=0):
    """No-follow walk; the operator packet and its ancestors cannot be writable."""
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "packet_path")
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
            info = os.fstat(directory)
            require(info.st_uid == uid and not stat.S_IMODE(info.st_mode) & 0o022, "packet_ancestor")
        info = os.fstat(directory)
        require(info.st_uid == uid and stat.S_IMODE(info.st_mode) == 0o700, "packet_parent")
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == uid and
                    stat.S_IMODE(before.st_mode) == 0o600 and 0 < before.st_size <= 16384, "packet_file")
            raw = os.read(fd, 16385)
            after = os.fstat(fd)
            fields = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_nlink", "st_mtime_ns", "st_ctime_ns")
            require(all(getattr(before, k) == getattr(after, k) for k in fields) and len(raw) == before.st_size, "packet_drift")
        finally:
            os.close(fd)
    finally:
        os.close(directory)
    packet = json.loads(raw, object_pairs_hook=unique)
    return packet, hashlib.sha256(raw).hexdigest()


def read_packet(path, uid=0):
    packet, digest = read_document(path, uid)
    validate(packet)
    return packet, digest


def packet_fingerprint(packet):
    return hashlib.sha256(json.dumps(packet, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


TrustedAdmission = namedtuple("TrustedAdmission", ("packet_fingerprint", "evidence"))


def trusted_evidence(packet, read=read_document):
    records = {}
    digests = []
    for name, reference in packet["protocolEvidence"].items():
        document, digest = read(reference["path"])
        require(digest == reference["sha256"], "trusted_evidence_drift")
        records[name] = document
        digests.append((reference["path"], digest))
    derivative = records["backendDerivative"]
    require(isinstance(derivative, dict) and derivative.get("schema") == "phone11-voicemail-epoch-backend-derivative/v2" and
            derivative.get("patchCommit") == TRUSTED_PATCH_COMMIT and
            derivative.get("patchStorageSha256") == TRUSTED_SOURCE_INPUTS["backendStorage"] and
            derivative.get("schemaFixCommit") == TRUSTED_SCHEMA_FIX_COMMIT and
            derivative.get("reviewedSources") == TRUSTED_BACKEND_SOURCES and
            derivative.get("patchedBundleSha256") == packet["backendBundleSha256"] and
            derivative.get("sourceChanges") == sorted(TRUSTED_BACKEND_SOURCES) and
            derivative.get("externalRuntimeDependenciesUnchanged") is True, "trusted_backend_source")
    ingress = records["trustedIngress"]
    exact(ingress, {"schema", "status", "lane", "freeswitch", "backend", "backendBundleSha256", "sourceInputs",
                    "nativeConfig", "loadedDialplan", "nativeGlobalHookReady", "backendGlobalHookReady",
                    "backendDerivativeSha256", "backendRuntimeProofSha256", "uploadUrl", "uploadRouteProofSha256",
                    "ownerEpochAdmissionPath"})
    require(ingress["schema"] == "phone11-trusted-local-fallback-commissioning/v1" and
            ingress["status"] == "loaded-one-use-owner-epoch-ingress-bound" and ingress["lane"] == TRUSTED_LANE and
            ingress["freeswitch"] == packet["freeswitch"] and ingress["backend"] == packet["backend"] and
            ingress["backendBundleSha256"] == packet["backendBundleSha256"] and
            ingress["sourceInputs"] == TRUSTED_SOURCE_INPUTS and ingress["nativeGlobalHookReady"] is False and
            ingress["backendGlobalHookReady"] is False and
            ingress["backendDerivativeSha256"] == TRUSTED_DERIVATIVE_MANIFEST and
            ingress["uploadUrl"] == packet["uploadUrl"] and ingress["ownerEpochAdmissionPath"] == TRUSTED_ADMISSION_PATH and
            isinstance(ingress["uploadRouteProofSha256"], str) and HASH.fullmatch(ingress["uploadRouteProofSha256"]) and
            isinstance(ingress["backendRuntimeProofSha256"], str) and HASH.fullmatch(ingress["backendRuntimeProofSha256"]),
            "trusted_ingress_binding")
    config = ingress["nativeConfig"]
    exact(config, {"kamailioIp", "apiBase", "handoffRoot"})
    require(isinstance(config["kamailioIp"], str) and str(ipaddress.IPv4Address(config["kamailioIp"])) == config["kamailioIp"],
            "trusted_kamailio_ip")
    require(config["apiBase"] in ("http://127.0.0.1:3012/api/voicemail/local-fallback",
                                  "http://127.0.0.1:3013/api/voicemail/local-fallback"), "trusted_redemption_url")
    root = config["handoffRoot"]
    require(isinstance(root, str) and re.fullmatch(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+", root) and
            all(x not in (".", "..") for x in root.split("/")) and
            root not in (SOURCE_ROOT, OUTBOX_ROOT), "trusted_handoff_root")
    dialplan = ingress["loadedDialplan"]
    exact(dialplan, {"context", "publicEntrySha256", "contextSha256", "proofSha256", "oneUseReferenceRequired",
                     "authenticatedKamailioSourceBound", "canonicalOwnerEpochHandoff"})
    require(dialplan["context"] == "phone11-local-voicemail" and
            all(isinstance(dialplan[k], str) and HASH.fullmatch(dialplan[k])
                for k in ("publicEntrySha256", "contextSha256", "proofSha256")) and
            all(dialplan[k] is True for k in ("oneUseReferenceRequired", "authenticatedKamailioSourceBound",
                                             "canonicalOwnerEpochHandoff")), "trusted_loaded_ingress")
    return TrustedAdmission(packet_fingerprint(packet), tuple(sorted(digests))), config


def selection(packet, explicit_trusted):
    require((packet["schema"] == TRUSTED_SCHEMA) == explicit_trusted, "trusted_lane_selection")


def command(*args):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    require(result.returncode == 0 and len(result.stdout) <= 65536, "metadata_command")
    return result.stdout.decode("utf-8", errors="strict").strip()


# Each probe emits selected nonsecret metadata only. It never enumerates an
# outbox/mailbox or opens a message. Config.Env and FS_SHARED_SECRET never leave
# the container; only a boolean checks that the existing secret is provisioned.
FS_PROBE = r'''const fs=require("node:fs"),crypto=require("node:crypto");
const dirs=["/var/lib/freeswitch/voicemail","/var/lib/phone11-voicemail/outbox"].map(p=>{
 const s=fs.lstatSync(p);return {directory:s.isDirectory(),symlink:s.isSymbolicLink(),uid:s.uid,gid:s.gid,mode:s.mode&4095};});
process.stdout.write(JSON.stringify({nodeMajor:Number(process.versions.node.split(".")[0]),uid:process.getuid(),gid:process.getgid(),dirs,
sourceRoot:process.env.PHONE11_VOICEMAIL_SOURCE_ROOT,outboxRoot:process.env.PHONE11_VOICEMAIL_OUTBOX,
uploadUrl:process.env.PHONE11_VOICEMAIL_UPLOAD_URL,hookReady:process.env.PHONE11_VOICEMAIL_HOOK_READY==="true",
secretConfigured:typeof process.env.FS_SHARED_SECRET==="string"&&process.env.FS_SHARED_SECRET.length>=32,
mailboxMapConfigured:typeof process.env.PHONE11_VOICEMAIL_MAILBOX_ROOTS==="string"&&process.env.PHONE11_VOICEMAIL_MAILBOX_ROOTS.length>2}));'''
TRUSTED_FS_PROBE = r'''const fs=require("node:fs"),root=process.env.PHONE11_VOICEMAIL_FALLBACK_HANDOFF_ROOT;
const s=typeof root==="string"?fs.lstatSync(root):null;
process.stdout.write(JSON.stringify({kamailioIp:process.env.PHONE11_VOICEMAIL_FALLBACK_KAM_IP,
apiBase:process.env.PHONE11_VOICEMAIL_FALLBACK_API_BASE,handoffRoot:root,
handoffDirectory:s?{directory:s.isDirectory(),symlink:s.isSymbolicLink(),uid:s.uid,gid:s.gid,mode:s.mode&4095}:null}));'''
BACKEND_PROBE = 'process.stdout.write(JSON.stringify({hookReady:process.env.PHONE11_VOICEMAIL_HOOK_READY==="true"}));'
INSPECT_FORMAT = '{{json .Id}} {{json .Name}} {{json .Image}} {{json .State.StartedAt}} {{json .State.Running}} {{json .State.Restarting}}'


def check(packet, invoke=command, read_evidence=read_document):
    validate(packet)
    trusted = packet["schema"] == TRUSTED_SCHEMA
    admission, native_config = trusted_evidence(packet, read_evidence) if trusted else (None, None)
    def containers():
        for key in ("backend", "freeswitch"):
            pin = packet[key]
            # Project only these fields; never request a full inspect/Env dump.
            raw = invoke("/usr/bin/docker", "inspect", "--format", INSPECT_FORMAT, pin["id"])
            values = [json.loads(item) for item in raw.split()]
            require(values == [pin["id"], "/" + pin["name"], pin["image"], pin["started"], True, False], "container_drift")
    containers()
    fsid, backend = packet["freeswitch"]["id"], packet["backend"]["id"]
    for name, target in (TRUSTED_ARTIFACT_PATHS if trusted else ARTIFACT_PATHS).items():
        require(invoke("/usr/bin/docker", "exec", fsid, "sha256sum", target).split() == [packet["artifacts"][name], target], "artifact_drift")
    target = "/app/dist/index.mjs"
    require(invoke("/usr/bin/docker", "exec", backend, "sha256sum", target).split() == [packet["backendBundleSha256"], target], "backend_bundle_drift")
    native = json.loads(invoke("/usr/bin/docker", "exec", fsid, "/usr/local/bin/node", "-e", FS_PROBE), object_pairs_hook=unique)
    expected_dirs = [{"directory": True, "symlink": False, "uid": 0, "gid": 0, "mode": 0o700}] * 2
    require(native == {"nodeMajor": 22, "uid": 0, "gid": 0, "dirs": expected_dirs,
                       "sourceRoot": SOURCE_ROOT, "outboxRoot": OUTBOX_ROOT, "uploadUrl": packet["uploadUrl"],
                       "hookReady": packet["hookReady"], "secretConfigured": True, "mailboxMapConfigured": True}, "native_configuration")
    backend_flags = json.loads(invoke("/usr/bin/docker", "exec", backend, "node", "-e", BACKEND_PROBE), object_pairs_hook=unique)
    require(backend_flags == {"hookReady": packet["hookReady"]}, "backend_hook_mismatch")
    if trusted:
        fallback = json.loads(invoke("/usr/bin/docker", "exec", fsid, "/usr/local/bin/node", "-e", TRUSTED_FS_PROBE),
                              object_pairs_hook=unique)
        require(fallback == dict(native_config, handoffDirectory=expected_dirs[0]), "trusted_native_configuration")
        require(trusted_evidence(packet, read_evidence)[0] == admission, "trusted_evidence_window_drift")
    containers()
    # Commissioning evidence is supplied by a reviewed operator operation; this
    # metadata check does not itself prove delivery or re-run its ingress proof.
    return admission


def run(packet, execute=subprocess.run, admission=None, read_evidence=read_document):
    if packet.get("schema") == TRUSTED_SCHEMA:
        validate(packet)
        require(isinstance(admission, TrustedAdmission) and admission.packet_fingerprint == packet_fingerprint(packet),
                "trusted_checks_required")
        require(trusted_evidence(packet, read_evidence)[0] == admission, "trusted_evidence_window_drift")
    else:
        require(packet["hookReady"] is True, "activation_packet_required")
    # One service pass only. The fixed outbox lock also protects an orphaned
    # Docker exec after a supervisor interruption from overlapping the next pass.
    result = execute(["/usr/bin/docker", "exec", packet["freeswitch"]["id"], "/usr/bin/flock", "-n",
                      OUTBOX_ROOT + "/.relay.lock", "/usr/local/bin/node", ARTIFACT_PATHS["relay.mjs"], "--once"],
                     stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    require(result.returncode == 0, "relay_pass_failed_or_locked")
    counts = re.fullmatch(rb"voicemail relay: delivered=(\d+) quarantined=(\d+) retry=(\d+)\n", result.stdout)
    require(counts is not None, "relay_result_shape")
    return dict(zip(("delivered", "quarantined", "retry"), map(int, counts.groups())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--config-sha256", required=True)
    parser.add_argument("--trusted-local-fallback-owner-epoch", action="store_true")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--run", action="store_true")
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, "root_required")
        require(HASH.fullmatch(args.config_sha256), "packet_digest")
        packet, digest = read_packet(args.config)
        require(digest == args.config_sha256, "packet_digest_drift")
        selection(packet, args.trusted_local_fallback_owner_epoch)
        admission = check(packet)
        # Re-read before any audio processing; a metadata-only --check never
        # reaches the relay command. The config digest is an independent unit pin.
        require(read_packet(args.config)[1] == digest, "packet_changed")
        counts = run(packet, admission=admission) if args.run else None
        print(json.dumps({"schema": packet["schema"], "status": "relay_pass_completed" if args.run else "metadata_checks_passed",
                          "messageAudioRead": bool(args.run), "deliveryAccepted": False,
                          "configSha256": digest, "counts": counts}, sort_keys=True))
        return 0
    except (Refused, OSError, ValueError, UnicodeError, subprocess.SubprocessError) as error:
        # Never render subprocess stderr, private paths, environment or messages.
        print(json.dumps({"schema": SCHEMA, "status": "refused", "deliveryAccepted": False,
                          "failureCode": str(error) if isinstance(error, Refused) else "metadata_unavailable"}, sort_keys=True))
        return 70


if __name__ == "__main__":
    raise SystemExit(main())
