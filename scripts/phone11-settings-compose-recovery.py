#!/usr/bin/env python3
"""Recover the deleted 3005 Compose source without changing the live candidate.

The current settings candidate is inspected exactly once. Its effective
configuration is converted into a root-only Compose JSON document, rendered by
``docker compose config``, and checked against the same constrained runtime
model before that document is published. This helper never calls ``up``,
``start``, ``restart``, ``stop``, or ``docker exec`` and never writes a
container, route, environment file, or secret to stdout.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from typing import Any, Iterator, Mapping, Sequence


HERE = Path(__file__).resolve().parent
PILOT_PATH = HERE / "phone11-parallel-api-pilot.py"
SPEC = importlib.util.spec_from_file_location("phone11_settings_compose_recovery_shared", PILOT_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - packaging failure
    raise RuntimeError("parallel operator unavailable")
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


SCHEMA = "phone11-settings-compose-recovery/v1"
CURRENT_CONTAINER = "cp11-api-candidate-settings"
CURRENT_SERVICE = "candidate_settings"
CURRENT_PROJECT = "phone11-api-settings-candidate"
CURRENT_PORT = 3005
ROLE = "api-candidate"
NETWORK = "cloudphone11-prod_cp11-net"
EXPECTED_EXPOSED_PORTS = {"3000/tcp", "3005/tcp"}
EXPECTED_MEMORY = 2_147_483_648
EXPECTED_MOUNTS = (
    ("/opt/phone11ai/cloud-media/recordings", "/var/lib/phone11/recordings", True, "rprivate"),
    ("/opt/phone11ai/cloud-media/spool", "/var/lib/phone11/recording-spool", True, "rprivate"),
    ("/var/lib/docker/volumes/phone11ai-voip_fs_recordings/_data/phone11", "/var/lib/freeswitch/recordings/phone11", True, "rslave"),
    ("/opt/phone11ai/auth-recovery-20260909/runtime-data", "/var/lib/phone11", True, "rprivate"),
    ("/opt/phone11ai/apns-private/wake-inactive-d8b81515a52d12c3/runtime-apns.p8", "/run/secrets/phone11-apns.p8", False, "rprivate"),
)

GuardError = pilot.GuardError
System = pilot.System
canonical_hash = pilot.canonical_hash
candidate_runtime_shape = pilot.candidate_runtime_shape
environment = pilot.environment
guarded = pilot.guarded
is_image_digest = pilot.is_image_digest
secure_read = pilot.secure_read
sha256_bytes = pilot.sha256_bytes


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _string_list(value: Any, stage: str, *, required: bool = True) -> list[str]:
    guarded(isinstance(value, list) and (bool(value) or not required) and all(isinstance(item, str) and "\x00" not in item for item in value), stage)
    return list(value)


def _absolute_path(value: Any, stage: str) -> str:
    guarded(isinstance(value, str) and value.startswith("/") and "\x00" not in value, stage)
    return value


def _compose_escape(value: str) -> str:
    """Preserve one effective literal dollar through Compose interpolation."""

    return value.replace("$", "$$")


def _compose_effective(value: str) -> str:
    """Normalize either canonical Compose-dollar representation to its value."""

    return value.replace("$$", "$")


def _health_to_compose(value: Any, build: str) -> dict[str, Any]:
    guarded(isinstance(value, Mapping), "healthcheck")
    allowed = {"Test", "Interval", "Timeout", "Retries", "StartPeriod", "StartInterval"}
    guarded("Test" in value and set(value).issubset(allowed), "healthcheck")
    test = _string_list(value.get("Test"), "healthcheck")
    joined = " ".join(test)
    guarded(test[0] == "CMD" and "node" in test and "127.0.0.1:3005/api/health" in joined and "runtimeRole" in joined and ROLE in joined and build in joined, "healthcheck")
    result: dict[str, Any] = {"test": test}
    for source, target, expected in (
        ("Interval", "interval", 10_000_000_000),
        ("Timeout", "timeout", 3_000_000_000),
        ("StartPeriod", "start_period", 10_000_000_000),
    ):
        duration = value.get(source)
        guarded(type(duration) is int and duration == expected, "healthcheck")
        result[target] = f"{duration}ns"
    retries = value.get("Retries")
    guarded(type(retries) is int and retries == 3, "healthcheck")
    result["retries"] = retries
    if "StartInterval" in value:
        duration = value["StartInterval"]
        guarded(type(duration) is int and duration >= 0, "healthcheck")
        result["start_interval"] = f"{duration}ns"
    return result


def _duration_from_compose(value: Any, stage: str) -> int:
    if type(value) is int:
        guarded(value >= 0, stage)
        return value
    guarded(isinstance(value, str), stage)
    matched = re.fullmatch(r"([0-9]+)(ns|us|ms|s|m|h)", value)
    guarded(matched is not None, stage)
    amount, unit = int(matched.group(1)), matched.group(2)
    return amount * {"ns": 1, "us": 1_000, "ms": 1_000_000, "s": 1_000_000_000, "m": 60_000_000_000, "h": 3_600_000_000_000}[unit]


def _health_from_compose(value: Any) -> dict[str, Any]:
    guarded(isinstance(value, Mapping), "compose_render")
    allowed = {"test", "interval", "timeout", "retries", "start_period", "start_interval"}
    guarded("test" in value and set(value).issubset(allowed), "compose_render")
    result: dict[str, Any] = {"Test": _string_list(value.get("test"), "compose_render")}
    for source, target in (
        ("interval", "Interval"), ("timeout", "Timeout"),
        ("start_period", "StartPeriod"), ("start_interval", "StartInterval"),
    ):
        if source in value:
            result[target] = _duration_from_compose(value[source], "compose_render")
    if "retries" in value:
        guarded(type(value["retries"]) is int and value["retries"] >= 0, "compose_render")
        result["Retries"] = value["retries"]
    return result


def _port(value: Any, stage: str) -> str:
    if type(value) is int:
        numeric = value
    else:
        guarded(isinstance(value, str), stage)
        matched = re.fullmatch(r"([0-9]+)(?:/(tcp))?", value)
        guarded(matched is not None, stage)
        numeric = int(matched.group(1))
    guarded(1 <= numeric <= 65_535, stage)
    return f"{numeric}/tcp"


def _exposed_ports(value: Any, stage: str) -> set[str]:
    guarded(isinstance(value, list), stage)
    result = {_port(item, stage) for item in value}
    guarded(len(result) == len(value), stage)
    return result


def _memory_bytes(value: Any, stage: str) -> int:
    if type(value) is int:
        guarded(value >= 0, stage)
        return value
    guarded(isinstance(value, str), stage)
    matched = re.fullmatch(r"([0-9]+)(|b|k|kb|m|mb|g|gb)", value.lower())
    guarded(matched is not None, stage)
    amount, unit = int(matched.group(1)), matched.group(2)
    return amount * {"": 1, "b": 1, "k": 1024, "kb": 1024, "m": 1024 ** 2, "mb": 1024 ** 2, "g": 1024 ** 3, "gb": 1024 ** 3}[unit]


def _mounts_from_inspect(value: Any) -> list[dict[str, Any]]:
    guarded(isinstance(value, list) and len(value) == len(EXPECTED_MOUNTS), "mounts")
    expected = {destination: (source, writable, propagation) for source, destination, writable, propagation in EXPECTED_MOUNTS}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for mount in value:
        guarded(isinstance(mount, Mapping), "mounts")
        source, destination = mount.get("Source"), mount.get("Destination")
        guarded(mount.get("Type") == "bind" and destination not in seen and destination in expected, "mounts")
        guarded(_absolute_path(source, "mounts") == expected[destination][0] and mount.get("RW") is expected[destination][1] and mount.get("Propagation") == expected[destination][2], "mounts")
        seen.add(destination)
        result.append({
            "type": "bind", "source": source, "target": destination,
            "read_only": not mount["RW"],
            "bind": {"propagation": mount["Propagation"], "create_host_path": False},
        })
    guarded(seen == set(expected), "mounts")
    return sorted(result, key=lambda item: item["target"])


def _mounts_from_compose(value: Any) -> list[dict[str, Any]]:
    guarded(isinstance(value, list) and len(value) == len(EXPECTED_MOUNTS), "compose_render")
    result: list[dict[str, Any]] = []
    for mount in value:
        guarded(isinstance(mount, Mapping), "compose_render")
        bind = mount.get("bind")
        guarded(mount.get("type") == "bind" and isinstance(bind, Mapping), "compose_render")
        guarded(bind.get("create_host_path") in (None, False), "compose_render")
        read_only = mount.get("read_only", False)
        guarded(type(read_only) is bool, "compose_render")
        result.append({
            "type": "bind", "source": _absolute_path(mount.get("source"), "compose_render"),
            "target": _absolute_path(mount.get("target"), "compose_render"),
            "read_only": read_only,
            "bind": {"propagation": bind.get("propagation"), "create_host_path": False},
        })
    return sorted(result, key=lambda item: item["target"])


def _non_compose_labels(value: Any, stage: str) -> dict[str, str]:
    guarded(value is None or isinstance(value, Mapping), stage)
    labels = dict(value or {})
    guarded(all(isinstance(key, str) and isinstance(item, str) for key, item in labels.items()), stage)
    return {key: item for key, item in labels.items() if not key.startswith("com.docker.compose.")}


def _service_networks(value: Any, stage: str) -> set[str]:
    if isinstance(value, Mapping):
        networks = set(value)
    else:
        guarded(isinstance(value, list) and all(isinstance(item, str) for item in value), stage)
        networks = set(value)
        guarded(len(networks) == len(value), stage)
    guarded(networks == {NETWORK}, stage)
    return networks


def validate_source(inspect: Any, *, expected_id: str, expected_image: str, expected_build: str) -> Mapping[str, Any]:
    """Accept only the pinned, unprivileged current Phone11 settings runtime."""

    guarded(isinstance(inspect, Mapping), "source_runtime")
    guarded(isinstance(expected_id, str) and bool(re.fullmatch(r"[0-9a-f]{64}", expected_id)), "arguments")
    guarded(is_image_digest(expected_image), "arguments")
    guarded(isinstance(expected_build, str) and bool(re.fullmatch(r"[A-Za-z0-9_.-]{7,128}", expected_build)), "arguments")
    config, host, network, state = (inspect.get(key) for key in ("Config", "HostConfig", "NetworkSettings", "State"))
    guarded(all(isinstance(item, Mapping) for item in (config, host, network, state)), "source_runtime")
    guarded(inspect.get("Id") == expected_id and inspect.get("Image") == expected_image and config.get("Image") == expected_image, "source_runtime")
    guarded(state.get("Running") is True and state.get("OOMKilled") is not True and state.get("Health", {}).get("Status") == "healthy", "source_runtime")
    env = dict(environment(inspect, "source_runtime"))
    guarded(env.get("PHONE11_RUNTIME_ROLE") == ROLE and env.get("PORT") == str(CURRENT_PORT) and env.get("PHONE11_BUILD_SHA") == expected_build, "source_runtime")

    labels = config.get("Labels")
    guarded(isinstance(labels, Mapping) and labels.get("com.docker.compose.project") == CURRENT_PROJECT and labels.get("com.docker.compose.service") == CURRENT_SERVICE, "source_runtime")
    guarded(config.get("WorkingDir") == "/app" and config.get("User") == "cloudphone", "source_runtime")
    entrypoint, command = _string_list(config.get("Entrypoint"), "source_runtime"), _string_list(config.get("Cmd"), "source_runtime")
    guarded(entrypoint == ["docker-entrypoint.sh"] and command == ["node", "dist/index.mjs"] and config.get("StopSignal") is None, "source_runtime")
    exposed = config.get("ExposedPorts")
    guarded(isinstance(exposed, Mapping) and set(exposed) == EXPECTED_EXPOSED_PORTS, "source_runtime")
    healthcheck = _health_to_compose(config.get("Healthcheck"), expected_build)

    bindings = host.get("PortBindings")
    guarded(bindings == {f"{CURRENT_PORT}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(CURRENT_PORT)}]}, "source_runtime")
    restart = host.get("RestartPolicy")
    guarded(isinstance(restart, Mapping) and restart.get("Name") == "unless-stopped" and restart.get("MaximumRetryCount") == 0, "source_runtime")
    guarded(host.get("NetworkMode") == NETWORK and host.get("ReadonlyRootfs") is False and host.get("Privileged") is False, "source_runtime")
    guarded(host.get("CapAdd") is None and host.get("CapDrop") is None and host.get("SecurityOpt") is None and host.get("Devices") is None and host.get("DeviceRequests") is None, "source_runtime")
    guarded(host.get("IpcMode") == "private" and host.get("Init") is None and host.get("PidsLimit") is None, "source_runtime")
    guarded(host.get("Memory") == EXPECTED_MEMORY and host.get("NanoCpus") == 0 and host.get("LogConfig") == {"Type": "json-file", "Config": {}}, "source_runtime")

    networks = network.get("Networks")
    guarded(isinstance(networks, Mapping) and set(networks) == {NETWORK}, "source_runtime")
    mounts = _mounts_from_inspect(inspect.get("Mounts"))
    return {
        "environment": env,
        "labels": _non_compose_labels(labels, "source_runtime"),
        "entrypoint": entrypoint,
        "command": command,
        "healthcheck": healthcheck,
        "mounts": mounts,
    }


def recovered_compose(inspect: Mapping[str, Any], *, expected_id: str, expected_image: str, expected_build: str) -> dict[str, Any]:
    """Create the sole candidate_settings source service from Docker inspect."""

    source = validate_source(inspect, expected_id=expected_id, expected_image=expected_image, expected_build=expected_build)
    service: dict[str, Any] = {
        "container_name": CURRENT_CONTAINER,
        "image": expected_image,
        "environment": {key: _compose_escape(value) for key, value in source["environment"].items()},
        "entrypoint": copy.deepcopy(source["entrypoint"]),
        "command": copy.deepcopy(source["command"]),
        "working_dir": "/app",
        "user": "cloudphone",
        "restart": "unless-stopped",
        "ports": [{"host_ip": "127.0.0.1", "published": str(CURRENT_PORT), "target": CURRENT_PORT, "protocol": "tcp", "mode": "ingress"}],
        "expose": sorted(EXPECTED_EXPOSED_PORTS),
        "networks": [NETWORK],
        "read_only": False,
        "ipc": "private",
        "mem_limit": f"{EXPECTED_MEMORY}b",
        "logging": {"driver": "json-file", "options": {}},
        "healthcheck": copy.deepcopy(source["healthcheck"]),
        "volumes": copy.deepcopy(source["mounts"]),
    }
    if source["labels"]:
        service["labels"] = source["labels"]
    return {
        "name": CURRENT_PROJECT,
        "services": {CURRENT_SERVICE: service},
        "networks": {NETWORK: {"external": True, "name": NETWORK}},
    }


def validate_rendered(rendered: Any, inspect: Mapping[str, Any], *, expected_id: str, expected_image: str, expected_build: str) -> None:
    """Require Compose rendering to preserve the source-runtime contract."""

    source = validate_source(inspect, expected_id=expected_id, expected_image=expected_image, expected_build=expected_build)
    guarded(isinstance(rendered, Mapping) and rendered.get("name") == CURRENT_PROJECT, "compose_render")
    services = rendered.get("services")
    guarded(isinstance(services, Mapping) and set(services) == {CURRENT_SERVICE}, "compose_render")
    service = services[CURRENT_SERVICE]
    guarded(isinstance(service, Mapping) and service.get("container_name") == CURRENT_CONTAINER and service.get("image") == expected_image, "compose_render")

    rendered_env = service.get("environment")
    guarded(isinstance(rendered_env, Mapping) and all(isinstance(key, str) and isinstance(value, str) for key, value in rendered_env.items()), "compose_render")
    guarded({key: _compose_effective(value) for key, value in rendered_env.items()} == source["environment"], "compose_render")
    guarded(_string_list(service.get("entrypoint"), "compose_render") == source["entrypoint"] and _string_list(service.get("command"), "compose_render") == source["command"], "compose_render")
    guarded(service.get("working_dir") == "/app" and service.get("user") == "cloudphone" and service.get("restart") == "unless-stopped", "compose_render")
    _service_networks(service.get("networks"), "compose_render")
    guarded(service.get("read_only") in (None, False) and service.get("ipc") == "private" and _memory_bytes(service.get("mem_limit"), "compose_render") == EXPECTED_MEMORY, "compose_render")
    guarded(not service.get("privileged") and not service.get("cap_add") and not service.get("cap_drop") and not service.get("security_opt") and not service.get("devices") and service.get("init") in (None, False) and service.get("pids_limit") is None, "compose_render")
    logging = service.get("logging")
    guarded(isinstance(logging, Mapping) and logging.get("driver") == "json-file" and logging.get("options") in (None, {}), "compose_render")

    ports = service.get("ports")
    guarded(isinstance(ports, list) and len(ports) == 1 and isinstance(ports[0], Mapping), "compose_render")
    port = ports[0]
    guarded(port.get("host_ip") == "127.0.0.1" and _port(port.get("published"), "compose_render") == f"{CURRENT_PORT}/tcp" and _port(port.get("target"), "compose_render") == f"{CURRENT_PORT}/tcp" and port.get("protocol", "tcp") == "tcp" and port.get("mode", "ingress") == "ingress", "compose_render")
    guarded(_exposed_ports(service.get("expose"), "compose_render") == EXPECTED_EXPOSED_PORTS, "compose_render")
    guarded(_mounts_from_compose(service.get("volumes")) == source["mounts"], "compose_render")
    guarded(_health_from_compose(service.get("healthcheck")) == inspect["Config"]["Healthcheck"], "compose_render")
    guarded(_non_compose_labels(service.get("labels"), "compose_render") == source["labels"], "compose_render")

    networks = rendered.get("networks")
    guarded(isinstance(networks, Mapping) and set(networks) == {NETWORK}, "compose_render")
    network = networks[NETWORK]
    guarded(isinstance(network, Mapping) and network.get("external") is True and network.get("name") == NETWORK, "compose_render")


def secure_output_parent(path: Path) -> None:
    guarded(path.is_absolute() and path.parent == Path("/root") and path.name and not os.path.lexists(path), "output")
    try:
        info = path.parent.lstat()
    except OSError as error:
        raise GuardError("output") from error
    guarded(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and not bool(info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)), "output")


@contextmanager
def staged_private_file(output: Path, raw: bytes) -> Iterator[Path]:
    descriptor: int | None = None
    temporary: Path | None = None
    try:
        descriptor, value = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".recovering", dir=output.parent)
        temporary = Path(value)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, 0, 0)
        remaining = memoryview(raw)
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise OSError("zero-length write")
            remaining = remaining[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        yield temporary
    except OSError as error:
        raise GuardError("output") from error
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def publish_new(temporary: Path, output: Path) -> None:
    """Publish a verified private file once; an existing name always blocks."""

    try:
        os.link(temporary, output)
        descriptor = os.open(output.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except FileExistsError as error:
        raise GuardError("output") from error
    except OSError as error:
        raise GuardError("output") from error


def validate_published(path: Path, raw: bytes) -> None:
    guarded(secure_read(path, mode=0o600) == raw, "output")


def recover(arguments: argparse.Namespace, system: System) -> tuple[str, str, str]:
    """Inspect, render-check, and publish one recovered 3005 source document."""

    guarded(os.geteuid() == 0, "root")
    secure_output_parent(arguments.output)
    inspected = system.json_command(["docker", "inspect", CURRENT_CONTAINER], "source_runtime")
    guarded(isinstance(inspected, list) and len(inspected) == 1 and isinstance(inspected[0], Mapping), "source_runtime")
    inspect = inspected[0]
    document = recovered_compose(
        inspect,
        expected_id=arguments.expected_container_id,
        expected_image=arguments.expected_image,
        expected_build=arguments.expected_build,
    )
    raw = canonical_bytes(document)
    with staged_private_file(arguments.output, raw) as staged:
        rendered = system.json_command([
            "docker", "compose", "--project-name", CURRENT_PROJECT,
            "--project-directory", str(arguments.output.parent), "-f", str(staged),
            "config", "--format", "json",
        ], "compose_render")
        validate_rendered(
            rendered, inspect,
            expected_id=arguments.expected_container_id,
            expected_image=arguments.expected_image,
            expected_build=arguments.expected_build,
        )
        publish_new(staged, arguments.output)
    validate_published(arguments.output, raw)
    return sha256_bytes(raw), canonical_hash(candidate_runtime_shape(inspect)), canonical_hash(rendered)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-container-id", required=True)
    parser.add_argument("--expected-image", required=True)
    parser.add_argument("--expected-build", required=True)
    arguments = parser.parse_args(argv)
    guarded(arguments.output.is_absolute(), "arguments")
    return arguments


def main(argv: Sequence[str]) -> int:
    try:
        arguments = parse_args(argv)
        output_sha, source_runtime_sha, rendered_sha = recover(arguments, System())
        print(f"recovery=READY output={arguments.output} output_sha256={output_sha} source_runtime_sha256={source_runtime_sha} rendered_sha256={rendered_sha}")
        return 0
    except GuardError as error:
        print(f"recovery=BLOCKED stage={error.stage}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
