#!/usr/bin/env python3
"""Exercise Phone11 outbound metadata through a real isolated FreeSWITCH."""

from __future__ import annotations

import argparse
import json
import os
import select
import socket
import time
import uuid
from pathlib import Path


SIP = ("127.0.0.1", 15080)
CARRIER = ("127.0.0.1", 16080)
ESL = ("127.0.0.1", 18021)
ESL_PASSWORD = "phone11-fixture-only"
PROTECTED_HEADERS = {
    "x-phone11-outbound-id",
    "x-phone11-authenticated-user",
    "x-phone11-authenticated-realm",
}
CASES = (
    ("thailand-local", "0812345678", "66812345678"),
    ("thailand-e164", "66812345678", "66812345678"),
    ("plus-prefix", "+14155550123", "14155550123"),
    ("general", "14155550123", "14155550123"),
)
SDP = (
    "v=0\r\n"
    "o=fixture 1 1 IN IP4 127.0.0.1\r\n"
    "s=phone11-freeswitch-fixture\r\n"
    "c=IN IP4 127.0.0.1\r\n"
    "t=0 0\r\n"
    "m=audio 17000 RTP/AVP 8\r\n"
    "a=rtpmap:8 PCMA/8000\r\n"
)


def parse_sip(packet: bytes) -> tuple[str, list[tuple[str, str]], bytes]:
    head, separator, body = packet.partition(b"\r\n\r\n")
    if not separator:
        raise AssertionError(f"malformed SIP packet: {packet[:200]!r}")
    lines = head.decode("utf-8", "strict").split("\r\n")
    headers: list[tuple[str, str]] = []
    for line in lines[1:]:
        if line[:1] in (" ", "\t"):
            name, value = headers[-1]
            headers[-1] = (name, value + " " + line.strip())
            continue
        name, value = line.split(":", 1)
        headers.append((name, value.strip()))
    return lines[0], headers, body


def values(headers: list[tuple[str, str]], name: str) -> list[str]:
    wanted = name.lower()
    return [value for key, value in headers if key.lower() == wanted]


def invite(
    destination: str,
    call_id: str,
    nonce: str,
    user: str,
    realm: str,
    include_metadata: bool,
) -> bytes:
    body = SDP.encode("ascii")
    uri = f"sip:{destination}@127.0.0.1:15080"
    branch = "z9hG4bK" + uuid.uuid4().hex
    headers = [
        ("Via", f"SIP/2.0/UDP 127.0.0.1:15090;branch={branch};rport"),
        ("Max-Forwards", "70"),
        ("From", f"<sip:3001@phone11.test>;tag={uuid.uuid4().hex[:12]}"),
        ("To", f"<{uri}>"),
        ("Call-ID", call_id),
        ("CSeq", "1 INVITE"),
        ("Contact", "<sip:3001@127.0.0.1:15090>"),
    ]
    if include_metadata:
        headers.extend(
            (
                ("X-Phone11-Outbound-ID", nonce),
                ("X-Phone11-Authenticated-User", user),
                ("X-Phone11-Authenticated-Realm", realm),
            )
        )
    headers.extend((("Content-Type", "application/sdp"), ("Content-Length", str(len(body)))))
    return (f"INVITE {uri} SIP/2.0\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers) + "\r\n").encode("ascii") + body


def response(packet: bytes, status: str) -> bytes:
    _, headers, _ = parse_sip(packet)
    selected: list[tuple[str, str]] = []
    for name in ("Via", "From", "To", "Call-ID", "CSeq"):
        for value in values(headers, name):
            if name == "To" and ";tag=" not in value:
                value += ";tag=fixture-carrier"
            selected.append((name, value))
    return (f"SIP/2.0 {status}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in selected) + "Content-Length: 0\r\n\r\n").encode("ascii")


class Esl:
    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buffer = b""

    @classmethod
    def connect(cls, timeout: float = 30.0) -> "Esl":
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                sock = socket.create_connection(ESL, timeout=1)
                sock.settimeout(3)
                esl = cls(sock)
                headers, _ = esl.frame()
                if headers.get("content-type") != "auth/request":
                    raise AssertionError(f"unexpected ESL greeting: {headers}")
                sock.sendall(f"auth {ESL_PASSWORD}\n\n".encode("ascii"))
                headers, _ = esl.frame()
                if not headers.get("reply-text", "").startswith("+OK"):
                    raise AssertionError(f"ESL authentication failed: {headers}")
                return esl
            except (ConnectionError, OSError, AssertionError) as error:
                last_error = error
                time.sleep(0.2)
        raise AssertionError(f"FreeSWITCH ESL did not become ready: {last_error}")

    def close(self) -> None:
        self.sock.close()

    def frame(self) -> tuple[dict[str, str], bytes]:
        while b"\n\n" not in self.buffer and b"\r\n\r\n" not in self.buffer:
            chunk = self.sock.recv(65535)
            if not chunk:
                raise ConnectionError("ESL closed")
            self.buffer += chunk
        lf = self.buffer.find(b"\n\n")
        crlf = self.buffer.find(b"\r\n\r\n")
        if crlf >= 0 and (lf < 0 or crlf < lf):
            index, width = crlf, 4
        else:
            index, width = lf, 2
        raw_headers, self.buffer = self.buffer[:index], self.buffer[index + width :]
        headers: dict[str, str] = {}
        for line in raw_headers.replace(b"\r\n", b"\n").split(b"\n"):
            if not line:
                continue
            key, value = line.decode("utf-8", "replace").split(":", 1)
            headers[key.lower()] = value.strip()
        length = int(headers.get("content-length", "0"))
        while len(self.buffer) < length:
            chunk = self.sock.recv(65535)
            if not chunk:
                raise ConnectionError("ESL closed during body")
            self.buffer += chunk
        body, self.buffer = self.buffer[:length], self.buffer[length:]
        return headers, body

    def api(self, command: str) -> str:
        self.sock.sendall(f"api {command}\n\n".encode("utf-8"))
        headers, body = self.frame()
        if headers.get("content-type") != "api/response":
            raise AssertionError(f"unexpected ESL API response: {headers}")
        return body.decode("utf-8", "replace")


def wait_profile(esl: Esl) -> None:
    deadline = time.monotonic() + 20
    last_status = ""
    start_result = "not attempted"
    located = "not inspected"
    attempted = False
    while time.monotonic() < deadline:
        last_status = esl.api("sofia status profile external")
        if "Name" in last_status and "external" in last_status and "127.0.0.1:15080" in last_status:
            return
        if not attempted and "Invalid Profile" in last_status:
            attempted = True
            located = esl.api("xml_locate configuration sofia.conf")
            start_result = esl.api("sofia profile external start")
        time.sleep(0.2)
    raise AssertionError(
        "FreeSWITCH external fixture profile did not become ready: "
        f"status={last_status[:300]!r}, start={start_result[:300]!r}, xml={located[:500]!r}"
    )


def receive_carrier_invite(
    carrier: socket.socket,
    caller: socket.socket,
    seen_call_ids: set[str],
    source_call_id: str,
    timeout: float = 5.0,
) -> tuple[bytes, tuple[str, int]]:
    deadline = time.monotonic() + timeout
    caller_responses: list[str] = []
    while time.monotonic() < deadline:
        ready, _, _ = select.select([carrier, caller], [], [], max(0.05, deadline - time.monotonic()))
        if not ready:
            break
        if caller in ready:
            packet, _ = caller.recvfrom(65535)
            start, headers, _ = parse_sip(packet)
            caller_responses.append(start)
            response_call_ids = values(headers, "Call-ID")
            if (
                response_call_ids == [source_call_id]
                and start.startswith("SIP/2.0 ")
                and not start.startswith(("SIP/2.0 100", "SIP/2.0 180", "SIP/2.0 183"))
            ):
                raise AssertionError(f"FreeSWITCH rejected fixture INVITE: {caller_responses}")
        if carrier not in ready:
            continue
        packet, address = carrier.recvfrom(65535)
        start, headers, _ = parse_sip(packet)
        call_ids = values(headers, "Call-ID")
        if start.startswith("INVITE ") and len(call_ids) == 1 and call_ids[0] not in seen_call_ids:
            seen_call_ids.add(call_ids[0])
            return packet, address
    raise AssertionError(f"carrier fixture did not receive an INVITE; caller responses={caller_responses}")


def find_a_leg(esl: Esl, source_call_id: str, timeout: float = 5.0) -> dict[str, str]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        shown = json.loads(esl.api("show channels as json"))
        for row in shown.get("rows", []):
            channel_uuid = row.get("uuid")
            if not isinstance(channel_uuid, str):
                continue
            try:
                dumped = json.loads(esl.api(f"uuid_dump {channel_uuid} json"))
            except json.JSONDecodeError:
                continue
            if dumped.get("Call-Direction") == "inbound" and dumped.get("variable_sip_call_id") == source_call_id:
                return dumped
        time.sleep(0.1)
    raise AssertionError(f"could not find inbound A-leg for {source_call_id}")


def wait_call_gone(esl: Esl, source_call_id: str, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        shown = json.loads(esl.api("show channels as json"))
        present = False
        for row in shown.get("rows", []):
            channel_uuid = row.get("uuid")
            if not isinstance(channel_uuid, str):
                continue
            body = esl.api(f"uuid_dump {channel_uuid} json")
            try:
                if json.loads(body).get("variable_sip_call_id") == source_call_id:
                    present = True
                    break
            except json.JSONDecodeError:
                pass
        if not present:
            return
        time.sleep(0.1)
    raise AssertionError(f"call did not clear after synthetic carrier response: {source_call_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("baseline", "candidate"), required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    if args.mode == "candidate" and args.baseline is None:
        raise SystemExit("candidate mode requires --baseline")
    baseline = json.loads(args.baseline.read_text(encoding="utf-8")) if args.baseline else None
    identity_results: dict[str, dict[str, list[str]]] = {}
    caller = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    carrier = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    caller.bind(("127.0.0.1", 15090))
    carrier.bind(CARRIER)
    esl = Esl.connect()
    seen_carrier_call_ids: set[str] = set()
    try:
        wait_profile(esl)
        for index, (label, source, expected) in enumerate(CASES, start=1):
            nonce = str(uuid.uuid4())
            user = f"30{index:02d}"
            realm = "phone11.test"
            source_call_id = f"{label}-{uuid.uuid4().hex}@fixture"
            caller.sendto(
                invite(source, source_call_id, nonce, user, realm, args.mode == "candidate"),
                SIP,
            )
            outbound, carrier_reply_address = receive_carrier_invite(
                carrier, caller, seen_carrier_call_ids, source_call_id
            )
            start, headers, _ = parse_sip(outbound)
            request_uri = start.split(" ", 2)[1]
            if not request_uri.startswith(f"sip:{expected}@127.0.0.1:16080"):
                raise AssertionError(f"{label} routed to unexpected destination: {request_uri}")
            identity = {
                "p_asserted_identity": values(headers, "P-Asserted-Identity"),
                "remote_party_id": values(headers, "Remote-Party-ID"),
            }
            identity_results[label] = identity
            if args.mode == "candidate":
                a_leg = find_a_leg(esl, source_call_id)
                expected_fields = {
                    "Call-Direction": "inbound",
                    "variable_phone11_outbound_id": nonce,
                    "variable_phone11_authenticated_user": user,
                    "variable_phone11_authenticated_realm": realm,
                    "variable_call_direction": "outbound",
                    "variable_sip_received_ip": "127.0.0.1",
                    "variable_sofia_profile_name": "external",
                }
                for field, expected_value in expected_fields.items():
                    if a_leg.get(field) != expected_value:
                        raise AssertionError(f"{label} A-leg {field}={a_leg.get(field)!r}, expected {expected_value!r}")
                for field in ("variable_bypass_media", "variable_bypass_media_after_bridge", "variable_proxy_media"):
                    if field in a_leg and a_leg[field].lower() not in ("false", "0", "no", "off"):
                        raise AssertionError(f"{label} A-leg enabled non-anchored media through {field}")

                leaked = [name for name, _ in headers if name.lower() in PROTECTED_HEADERS]
                if leaked:
                    raise AssertionError(f"{label} leaked protected headers: {leaked}")
                expected_identity = baseline["identity"][label]
                if identity != expected_identity:
                    raise AssertionError(
                        f"{label} changed carrier identity headers: baseline={expected_identity!r}, candidate={identity!r}"
                    )

            carrier.sendto(response(outbound, "486 Busy Here"), carrier_reply_address)
            wait_call_gone(esl, source_call_id)
            print(f"PASS {args.mode} {label}: {source} -> {expected}")
    finally:
        esl.close()
        caller.close()
        carrier.close()

    payload = {"mode": args.mode, "identity": identity_results}
    args.result.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(args.result, 0o600)
    if args.mode == "candidate":
        absent = all(not result["remote_party_id"] for result in identity_results.values())
        print("PASS exact A-leg metadata, direction, received peer, profile, and anchored-media contract")
        print(f"PASS caller-ID behavior equals baseline (Remote-Party-ID baseline absent={str(absent).lower()})")
        print("PASS protected metadata remained internal and all four real dialplan routes were preserved")


if __name__ == "__main__":
    main()
