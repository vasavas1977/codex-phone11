#!/usr/bin/env python3
"""One-shot protected installer for Phone11's admitted Connect11 video keys.

The only credential input path is ``getpass``.  Credential values are kept in
process memory, sent to the verified host over SSH stdin, and are never put in
arguments, environment variables, files on this machine, or diagnostics.
``--dry-run`` performs the same local contract validation without AWS or SSH.
It does not activate a feature, restart a service, or modify the server.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


CUSTOMER_ID = "cust-2d2ded98a329"
TENANT_NAMESPACE = "6fa4634ade063138"
CONNECT11_API_URL = "https://api.connect11.ai"
CONNECT11_RTC_URL = "wss://connect11-platform-zm6g4d8f.livekit.cloud"
LIVE_KEY_PREFIX = "c11_live_"
INSTANCE_ID = "i-0851dd1ea1cfeef71"
REGION = "ap-southeast-7"
AVAILABILITY_ZONE = "ap-southeast-7a"
HOST = "43.210.122.111"
REMOTE_USER = "ubuntu"
EXPECTED_ACCOUNT_ID = "326786006484"
CONFIG_FILE = "/etc/phone11/connect11-plain-video.env"
METADATA_FILE = "/etc/phone11/connect11-plain-video-credential-metadata.json"
CONFIG_VARIABLE = "PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS"


class InstallerError(RuntimeError):
    """A safe, deliberately non-diagnostic installer failure."""

    def __init__(self, stage: str = "install") -> None:
        super().__init__(stage)
        self.stage = stage


def guarded(condition: bool, stage: str = "validation") -> None:
    if not condition:
        raise InstallerError(stage)


def valid_opaque_metadata(value: Any, *, maximum: int = 256) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_.:@/+\-]{1,%d}" % maximum, value))


def valid_metadata_name(value: Any) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= 128
        and value == value.strip()
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
    )


def validate_metadata(metadata: Any) -> dict[str, dict[str, Any]]:
    """Validate exactly the metadata subsequently required by the activation guard."""

    guarded(isinstance(metadata, dict) and set(metadata) == {"status", "join_evict"})
    expected = {
        "status": ["realtime:plain-video:status"],
        "join_evict": ["realtime:plain-video:join", "realtime:plain-video:evict"],
    }
    ids: set[str] = set()
    prefixes: set[str] = set()
    normalized: dict[str, dict[str, Any]] = {}
    expected_fields = {
        "id",
        "customer_id",
        "tenant_namespace",
        "name",
        "key_prefix",
        "scopes",
        "environment",
        "product_code",
        "phone11_credential_type",
        "status",
    }
    for role, exact_scopes in expected.items():
        record = metadata.get(role)
        guarded(isinstance(record, dict) and set(record) == expected_fields)
        credential_id = record.get("id")
        key_prefix = record.get("key_prefix")
        scopes = record.get("scopes")
        guarded(valid_opaque_metadata(credential_id))
        guarded(valid_metadata_name(record.get("name")))
        guarded(
            isinstance(key_prefix, str)
            and len(key_prefix) > len(LIVE_KEY_PREFIX)
            and key_prefix.startswith(LIVE_KEY_PREFIX)
            and not any(character.isspace() for character in key_prefix)
        )
        guarded(record.get("customer_id") == CUSTOMER_ID)
        guarded(record.get("tenant_namespace") == TENANT_NAMESPACE)
        guarded(
            isinstance(scopes, list)
            and len(scopes) == len(exact_scopes)
            and all(isinstance(scope, str) for scope in scopes)
            and set(scopes) == set(exact_scopes)
        )
        guarded(record.get("environment") == "live")
        guarded(record.get("product_code") == "connect11")
        guarded(record.get("phone11_credential_type") == role)
        guarded(record.get("status") == "active")
        guarded(credential_id not in ids and key_prefix not in prefixes)
        ids.add(credential_id)
        prefixes.add(key_prefix)
        normalized[role] = record
    return normalized


def validate_token(token: Any, *, prefix: str) -> str:
    guarded(
        isinstance(token, str)
        and 1 <= len(token) <= 4096
        and token == token.strip()
        and "\n" not in token
        and "\r" not in token
        and "\x00" not in token
        and token.startswith(prefix),
    )
    return token


def build_payload(metadata: Any, status_token: Any, join_token: Any) -> dict[str, str]:
    """Create the exact files consumed by the guarded activation program."""

    records = validate_metadata(metadata)
    status = validate_token(status_token, prefix=records["status"]["key_prefix"])
    join_evict = validate_token(join_token, prefix=records["join_evict"]["key_prefix"])
    guarded(status != join_evict)
    mapping = {
        "enabled": True,
        "tenants": [
            {
                "tenantId": 1,
                "customerKey": CUSTOMER_ID,
                "apiBaseUrl": CONNECT11_API_URL,
                "rtcUrl": CONNECT11_RTC_URL,
                "statusCredential": status,
                "joinCredential": join_evict,
            },
        ],
    }
    return {
        "env": CONFIG_VARIABLE + "=" + json.dumps(mapping, separators=(",", ":")) + "\n",
        "metadata": json.dumps(records, separators=(",", ":")) + "\n",
    }


def read_metadata(path: Path) -> dict[str, Any]:
    try:
        info = path.lstat()
        guarded(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), "metadata")
        guarded(info.st_size <= 65_536, "metadata")
        raw = path.read_bytes()
        document = json.loads(raw)
    except (InstallerError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        if isinstance(error, InstallerError):
            raise
        raise InstallerError("metadata") from error
    guarded(isinstance(document, dict), "metadata")
    return document


def command(args: Sequence[str], *, stdin: bytes | None = None, timeout: int = 30) -> None:
    """Run a command without exposing diagnostics or accepting shell text."""

    try:
        result = subprocess.run(
            list(args),
            input=stdin,
            stdin=subprocess.DEVNULL if stdin is None else None,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InstallerError("transport") from error
    if result.returncode != 0:
        raise InstallerError("transport")


def json_command(args: Sequence[str], *, stage: str) -> Any:
    """Read nonsecret AWS identity/instance JSON without reporting it."""

    try:
        result = subprocess.run(
            list(args),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            raise InstallerError(stage)
        return json.loads(result.stdout)
    except InstallerError:
        raise
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        raise InstallerError(stage) from error


def require_aws_target() -> None:
    identity = json_command(["aws", "sts", "get-caller-identity", "--output", "json"], stage="aws_identity")
    guarded(isinstance(identity, dict) and identity.get("Account") == EXPECTED_ACCOUNT_ID, "aws_identity")
    document = json_command(
        [
            "aws",
            "ec2",
            "describe-instances",
            "--region",
            REGION,
            "--instance-ids",
            INSTANCE_ID,
            "--output",
            "json",
        ],
        stage="aws_instance",
    )
    try:
        reservations = document["Reservations"]
        instances = reservations[0]["Instances"]
        instance = instances[0]
    except (KeyError, IndexError, TypeError) as error:
        raise InstallerError("aws_instance") from error
    guarded(isinstance(reservations, list) and len(reservations) == 1, "aws_instance")
    guarded(isinstance(instances, list) and len(instances) == 1 and isinstance(instance, dict), "aws_instance")
    guarded(instance.get("InstanceId") == INSTANCE_ID, "aws_instance")
    guarded(instance.get("State", {}).get("Name") == "running", "aws_instance")
    guarded(instance.get("Placement", {}).get("AvailabilityZone") == AVAILABILITY_ZONE, "aws_instance")
    guarded(instance.get("PublicIpAddress") == HOST, "aws_instance")


def require_known_host(known_hosts: Path) -> None:
    try:
        info = known_hosts.lstat()
        guarded(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode), "host_key")
    except (InstallerError, OSError) as error:
        if isinstance(error, InstallerError):
            raise
        raise InstallerError("host_key") from error
    command(["ssh-keygen", "-F", HOST, "-f", str(known_hosts)])


def ssh_arguments(private_key: Path, known_hosts: Path) -> list[str]:
    return [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        f"UserKnownHostsFile={known_hosts}",
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-i",
        str(private_key),
        f"{REMOTE_USER}@{HOST}",
    ]


def temporary_instance_connect_key(known_hosts: Path, operation: Callable[[list[str]], None]) -> None:
    """Authorize an ephemeral key only after the expected account/host are pinned."""

    require_aws_target()
    require_known_host(known_hosts)
    with tempfile.TemporaryDirectory(prefix="phone11-connect11-key-") as temporary_directory:
        key_path = Path(temporary_directory) / "id_ed25519"
        command(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key_path)])
        command(
            [
                "aws",
                "ec2-instance-connect",
                "send-ssh-public-key",
                "--region",
                REGION,
                "--instance-id",
                INSTANCE_ID,
                "--availability-zone",
                AVAILABILITY_ZONE,
                "--instance-os-user",
                REMOTE_USER,
                "--ssh-public-key",
                "file://" + str(key_path) + ".pub",
                "--output",
                "json",
            ],
        )
        operation(ssh_arguments(key_path, known_hosts))


def authorize_and_install(payload: Mapping[str, str], known_hosts: Path) -> None:
    """Install through an ephemeral EC2 Instance Connect session."""

    def install(ssh: list[str]) -> None:
        # The nonsecret writer is transmitted as a shell-quoted Python source,
        # then executed by sudo directly.  No user-writable remote pathname is
        # introduced between verification and root execution.
        command(
            ssh + ["sudo -n /usr/bin/python3 -c " + shlex.quote(REMOTE_WRITER)],
            stdin=json.dumps(dict(payload), separators=(",", ":")).encode("utf-8"),
        )

    temporary_instance_connect_key(known_hosts, install)


REMOTE_PREPARE = r'''import os, stat
from pathlib import Path

class PrepareError(RuntimeError):
    pass

def require(condition):
    if not condition:
        raise PrepareError()

PHONE11_DIRECTORY = Path("/etc/phone11")

def root_owned(info):
    return info.st_uid == 0 and info.st_gid == 0

def secure_existing_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode))
    require(root_owned(info))
    require(not (info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)))

def main():
    try:
        secure_existing_directory(PHONE11_DIRECTORY.parent)
        try:
            PHONE11_DIRECTORY.lstat()
        except FileNotFoundError:
            # The installer will create this child only after this parent
            # passed its root-owned/non-link/non-writable guard.
            return 0
        secure_existing_directory(PHONE11_DIRECTORY)
        for candidate in (
            PHONE11_DIRECTORY / "connect11-plain-video.env",
            PHONE11_DIRECTORY / "connect11-plain-video-credential-metadata.json",
        ):
            try:
                candidate.lstat()
            except FileNotFoundError:
                continue
            raise PrepareError()
        return 0
    except BaseException:
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
'''


def authorize_prepare(known_hosts: Path) -> None:
    """Credential-free remote preflight; it performs no remote writes."""

    def prepare(ssh: list[str]) -> None:
        command(ssh + ["sudo -n /usr/bin/python3 -c " + shlex.quote(REMOTE_PREPARE)])

    try:
        temporary_instance_connect_key(known_hosts, prepare)
    except InstallerError as error:
        if error.stage == "transport":
            raise InstallerError("remote_preflight") from error
        raise


# This source contains paths and file-safety mechanics only; it never embeds a
# credential.  The credential-bearing JSON arrives only on its standard input.
REMOTE_WRITER = r'''#!/usr/bin/env python3
import json
import os
import stat
import sys
from pathlib import Path

CONFIG_FILE = Path("/etc/phone11/connect11-plain-video.env")
METADATA_FILE = Path("/etc/phone11/connect11-plain-video-credential-metadata.json")
MAX_PAYLOAD = 131072

class WriterError(RuntimeError):
    pass

def require(condition):
    if not condition:
        raise WriterError()

def root_owned(info):
    return info.st_uid == 0 and info.st_gid == 0

def secure_directory(path, create=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        require(create)
        path.mkdir(mode=0o700)
        info = path.lstat()
    require(stat.S_ISDIR(info.st_mode))
    require(not stat.S_ISLNK(info.st_mode))
    require(root_owned(info))
    require(not (info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)))

def require_absent(path):
    try:
        path.lstat()
    except FileNotFoundError:
        return
    raise WriterError()

def write_new_file(path, content):
    descriptor = None
    created = False
    completed = False
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        created = True
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode))
        require(root_owned(info))
        require(stat.S_IMODE(info.st_mode) == 0o600)
        require(info.st_nlink == 1)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            require(written > 0)
            view = view[written:]
        os.fsync(descriptor)
        completed = True
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if created and not completed:
            remove_if_new(path)

def remove_if_new(path):
    try:
        info = path.lstat()
        if stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and root_owned(info) and info.st_nlink == 1:
            path.unlink()
    except OSError:
        pass

def install(payload):
    require(os.geteuid() == 0)
    require(isinstance(payload, dict) and set(payload) == {"env", "metadata"})
    env = payload["env"]
    metadata = payload["metadata"]
    require(isinstance(env, str) and isinstance(metadata, str))
    require(0 < len(env) <= 65536 and 0 < len(metadata) <= 65536)
    require("\x00" not in env and "\x00" not in metadata)
    require("\r" not in env and "\r" not in metadata)
    require(CONFIG_FILE.parent == METADATA_FILE.parent)
    secure_directory(CONFIG_FILE.parent.parent)
    secure_directory(CONFIG_FILE.parent, create=True)
    require_absent(CONFIG_FILE)
    require_absent(METADATA_FILE)
    created = []
    try:
        write_new_file(CONFIG_FILE, env.encode("utf-8"))
        created.append(CONFIG_FILE)
        write_new_file(METADATA_FILE, metadata.encode("utf-8"))
        created.append(METADATA_FILE)
    except BaseException as error:
        for path in reversed(created):
            remove_if_new(path)
        raise WriterError() from error

def main():
    try:
        raw = sys.stdin.buffer.read(MAX_PAYLOAD + 1)
        require(len(raw) <= MAX_PAYLOAD)
        payload = json.loads(raw.decode("utf-8"))
        install(payload)
        return 0
    except BaseException:
        return 1

if __name__ == "__main__":
    sys.exit(main())
'''


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install guarded Phone11 Connect11 credential files once.")
    parser.add_argument("--metadata-json", type=Path, help="Trusted nonsecret credential inventory JSON.")
    parser.add_argument("--known-hosts", type=Path, default=Path.home() / ".ssh" / "known_hosts")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate inputs only; do not contact AWS or SSH.")
    mode.add_argument("--prepare", action="store_true", help="Credential-free AWS, host-key, and target-absence preflight.")
    return parser.parse_args(argv)


def run(
    arguments: argparse.Namespace,
    *,
    prompt: Callable[[str], str] = getpass.getpass,
) -> int:
    status_token = ""
    join_token = ""
    try:
        if arguments.prepare:
            authorize_prepare(arguments.known_hosts)
            print("installer=PREPARE_READY")
            return 0
        guarded(arguments.metadata_json is not None, "arguments")
        metadata = read_metadata(arguments.metadata_json)
        status_token = read_secret(prompt, "Connect11 status credential: ")
        join_token = read_secret(prompt, "Connect11 join/evict credential: ")
        payload = build_payload(metadata, status_token, join_token)
        if arguments.dry_run:
            print("installer=DRY_RUN_VALID")
        else:
            authorize_and_install(payload, arguments.known_hosts)
            print("installer=INSTALLED")
        return 0
    except InstallerError as error:
        print("installer=FAILED stage=" + error.stage, file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt, OSError):
        print("installer=FAILED stage=input", file=sys.stderr)
        return 1
    finally:
        # Python cannot guarantee immediate memory erasure, but credentials are
        # never persisted and these references are released at this boundary.
        status_token = ""
        join_token = ""


def read_secret(prompt: Callable[[str], str], message: str) -> str:
    """Use no-echo input only; reject getpass's non-TTY warning fallback."""

    try:
        if prompt is getpass.getpass:
            if not sys.stdin.isatty() or not sys.stderr.isatty():
                raise InstallerError("input")
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                return prompt(message)
        return prompt(message)
    except InstallerError:
        raise
    except (EOFError, KeyboardInterrupt, OSError, getpass.GetPassWarning) as error:
        raise InstallerError("input") from error


def main(argv: Sequence[str] | None = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
