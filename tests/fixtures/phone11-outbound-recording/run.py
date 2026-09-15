"""Real Kamailio digest-auth regression for outbound recording metadata."""

from __future__ import annotations

import hashlib
import os
import re
import signal
import socket
import subprocess
import tempfile
import time
import uuid


PROXY = ("127.0.0.1", 5060)
SINK = ("127.0.0.1", 5070)
REALM = "phone11.test"
PASSWORD = "fixture-password"
VALID_ID_UPPER = "A122A69C-772A-4F8E-91E4-F6FCD4E96A53"
VALID_ID_LOWER = VALID_ID_UPPER.lower()
PROTECTED = {
    "x-phone11-authenticated-user",
    "x-phone11-authenticated-realm",
    "x-phone11-outbound-id",
}
SDP = (
    "v=0\r\n"
    "o=fixture 1 1 IN IP4 192.0.2.10\r\n"
    "s=phone11-outbound-recording\r\n"
    "c=IN IP4 192.0.2.10\r\n"
    "t=0 0\r\n"
    "m=audio 40000 RTP/AVP 8\r\n"
)


def md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def parse_message(packet: bytes) -> tuple[str, list[tuple[str, str]], bytes]:
    head, separator, body = packet.partition(b"\r\n\r\n")
    assert separator, packet
    lines = head.decode("utf-8", "strict").split("\r\n")
    headers: list[tuple[str, str]] = []
    for line in lines[1:]:
        name, value = line.split(":", 1)
        headers.append((name, value.strip()))
    return lines[0], headers, body


def values(headers: list[tuple[str, str]], name: str) -> list[str]:
    expected = name.lower()
    return [value for key, value in headers if key.lower() == expected]


def challenge_parameters(value: str) -> dict[str, str]:
    assert value.lower().startswith("digest "), value
    params: dict[str, str] = {}
    for match in re.finditer(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', value[7:]):
        params[match.group(1).lower()] = match.group(2) or match.group(3)
    return params


def authorization(
    challenge: str,
    username: str,
    password: str,
    uri: str,
    realm_override: str | None = None,
) -> str:
    params = challenge_parameters(challenge)
    realm = realm_override or params["realm"]
    nonce = params["nonce"]
    qop = "auth" if "auth" in params.get("qop", "").split(",") else ""
    ha1 = md5(f"{username}:{realm}:{password}")
    ha2 = md5(f"INVITE:{uri}")
    fields = [
        f'username="{username}"',
        f'realm="{realm}"',
        f'nonce="{nonce}"',
        f'uri="{uri}"',
    ]
    if qop:
        nc = "00000001"
        cnonce = uuid.uuid4().hex[:16]
        response = md5(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
        fields.extend(
            [
                f'response="{response}"',
                "algorithm=MD5",
                f"qop={qop}",
                f"nc={nc}",
                f'cnonce="{cnonce}"',
            ]
        )
    else:
        response = md5(f"{ha1}:{nonce}:{ha2}")
        fields.extend([f'response="{response}"', "algorithm=MD5"])
    if params.get("opaque"):
        fields.append(f'opaque="{params["opaque"]}"')
    return "Digest " + ", ".join(fields)


def invite(
    uri: str,
    username: str,
    call_id: str,
    cseq: int,
    extra_headers: list[tuple[str, str]] | None = None,
    proxy_authorization: str | None = None,
    body: bytes = SDP.encode("utf-8"),
) -> bytes:
    branch = "z9hG4bK" + uuid.uuid4().hex
    headers = [
        ("Via", f"SIP/2.0/UDP 127.0.0.1:5090;branch={branch};rport"),
        ("Max-Forwards", "70"),
        ("From", f"<sip:{username}@{REALM}>;tag=fixture-{call_id}"),
        ("To", f"<{uri}>"),
        ("Call-ID", call_id),
        ("CSeq", f"{cseq} INVITE"),
        ("Contact", f"<sip:{username}@127.0.0.1:5090>"),
        ("Content-Type", "application/sdp"),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    if proxy_authorization:
        headers.append(("Proxy-Authorization", proxy_authorization))
    headers.append(("Content-Length", str(len(body))))
    start = f"INVITE {uri} SIP/2.0\r\n"
    encoded = start + "".join(f"{name}: {value}\r\n" for name, value in headers) + "\r\n"
    return encoded.encode("utf-8") + body


def receive_for(sock: socket.socket, call_id: str, status: str, timeout: float = 2.0) -> bytes:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        sock.settimeout(max(0.01, deadline - time.monotonic()))
        packet = sock.recv(65535)
        start, headers, _ = parse_message(packet)
        if call_id in values(headers, "Call-ID") and start.startswith(f"SIP/2.0 {status}"):
            return packet
    raise AssertionError(f"no {status} response for {call_id}")


def receive_sink(sink: socket.socket, call_id: str, timeout: float = 2.0) -> bytes:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        sink.settimeout(max(0.01, deadline - time.monotonic()))
        packet, address = sink.recvfrom(65535)
        start, headers, _ = parse_message(packet)
        if call_id not in values(headers, "Call-ID"):
            continue
        response_headers: list[tuple[str, str]] = []
        for name in ("Via", "From", "To", "Call-ID", "CSeq"):
            for value in values(headers, name):
                if name == "To" and ";tag=" not in value:
                    value += ";tag=fixture-sink"
                response_headers.append((name, value))
        response = "SIP/2.0 200 OK\r\n" + "".join(
            f"{name}: {value}\r\n" for name, value in response_headers
        ) + "Content-Length: 0\r\n\r\n"
        sink.sendto(response.encode("utf-8"), address)
        assert start.startswith("INVITE "), start
        return packet
    raise AssertionError(f"no forwarded INVITE for {call_id}")


def assert_sink_quiet(sink: socket.socket, timeout: float = 0.15) -> None:
    sink.settimeout(timeout)
    try:
        packet, _ = sink.recvfrom(65535)
    except socket.timeout:
        return
    raise AssertionError(f"unexpected forwarded SIP message: {packet[:200]!r}")


def authenticate_and_forward(
    client: socket.socket,
    sink: socket.socket,
    *,
    label: str,
    username: str = "3001",
    destination: str = "+66825826667",
    extra_headers: list[tuple[str, str]] | None = None,
    password: str = PASSWORD,
    realm_override: str | None = None,
    expect_forward: bool = True,
) -> bytes | None:
    call_id = f"{label}-{uuid.uuid4().hex}@fixture"
    uri = f"sip:{destination}@{REALM}"
    first = invite(uri, username, call_id, 1, extra_headers)
    client.sendto(first, PROXY)
    challenge_packet = receive_for(client, call_id, "407")
    _, challenge_headers, _ = parse_message(challenge_packet)
    challenges = values(challenge_headers, "Proxy-Authenticate")
    assert len(challenges) == 1, challenges
    digest = authorization(challenges[0], username, password, uri, realm_override)
    second = invite(uri, username, call_id, 2, extra_headers, digest)
    client.sendto(second, PROXY)
    if not expect_forward:
        receive_for(client, call_id, "407")
        assert_sink_quiet(sink)
        return None
    forwarded = receive_sink(sink, call_id)
    start, headers, body = parse_message(forwarded)
    assert start == f"INVITE {uri} SIP/2.0", start
    assert values(headers, "Call-ID") == [call_id], headers
    assert body == SDP.encode("utf-8"), body
    assert not values(headers, "Proxy-Authorization"), headers
    return forwarded


def assert_no_protected(packet: bytes) -> None:
    _, headers, _ = parse_message(packet)
    present = [name for name, _ in headers if name.lower() in PROTECTED]
    assert not present, present


def wait_ready(process: subprocess.Popen[bytes], log_path: str) -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    probe.settimeout(0.1)
    port = probe.getsockname()[1]
    request = (
        "OPTIONS sip:fixture@127.0.0.1 SIP/2.0\r\n"
        f"Via: SIP/2.0/UDP 127.0.0.1:{port};branch=z9hG4bKready\r\n"
        "From: <sip:probe@phone11.test>;tag=ready\r\n"
        "To: <sip:fixture@phone11.test>\r\n"
        "Call-ID: readiness@fixture\r\n"
        "CSeq: 1 OPTIONS\r\n"
        "Max-Forwards: 70\r\n"
        "Content-Length: 0\r\n\r\n"
    ).encode("utf-8")
    deadline = time.monotonic() + 20
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(open(log_path, encoding="utf-8").read())
            probe.sendto(request, PROXY)
            try:
                if b"405 Method Not Allowed" in probe.recv(65535):
                    return
            except socket.timeout:
                pass
    finally:
        probe.close()
    raise AssertionError("Kamailio SIP listener did not become ready")


def main() -> None:
    log = tempfile.NamedTemporaryFile(prefix="phone11-outbound-kam-", suffix=".log", delete=False)
    log_path = log.name
    process = subprocess.Popen(
        [
            "kamailio",
            "-DD",
            "-E",
            "-f",
            "/work/tests/fixtures/phone11-outbound-recording/runtime.cfg",
        ],
        stdout=log,
        stderr=log,
    )
    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client.bind(("127.0.0.1", 5090))
    sink = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sink.bind(SINK)
    try:
        wait_ready(process, log_path)

        # An INVITE without credentials is challenged and never reaches the sink.
        unauthenticated_id = f"unauthenticated-{uuid.uuid4().hex}@fixture"
        client.sendto(
            invite(
                f"sip:+66825826667@{REALM}",
                "3001",
                unauthenticated_id,
                1,
                [("X-Phone11-Outbound-ID", VALID_ID_LOWER)],
            ),
            PROXY,
        )
        receive_for(client, unauthenticated_id, "407")
        assert_sink_quiet(sink)

        # Direct invocation with unset auth AVPs must neither crash nor relay.
        unset_id = f"unset-avp-{uuid.uuid4().hex}@fixture"
        client.sendto(
            invite(
                f"sip:+66825826667@{REALM}",
                "3001",
                unset_id,
                1,
                [
                    ("X-Fixture-Test-Unset-Auth", "yes"),
                    ("X-Phone11-Outbound-ID", VALID_ID_LOWER),
                    ("X-Phone11-Authenticated-User", "spoof"),
                ],
            ),
            PROXY,
        )
        receive_for(client, unset_id, "403")
        assert_sink_quiet(sink)

        # Correct digest identity emits one sanitized, canonical metadata set.
        valid = authenticate_and_forward(
            client,
            sink,
            label="valid",
            extra_headers=[
                ("X-Phone11-Outbound-ID", VALID_ID_UPPER),
                ("X-Phone11-Authenticated-User", "spoofed-user"),
                ("x-phone11-authenticated-user", "second-spoof"),
                ("X-Phone11-Authenticated-Realm", "spoofed-realm"),
            ],
        )
        assert valid is not None
        _, valid_headers, _ = parse_message(valid)
        assert values(valid_headers, "X-Phone11-Authenticated-User") == ["3001"]
        assert values(valid_headers, "X-Phone11-Authenticated-Realm") == [REALM]
        assert values(valid_headers, "X-Phone11-Outbound-ID") == [VALID_ID_LOWER]

        invalid_cases = [
            ("missing-id", []),
            ("malformed-id", [("X-Phone11-Outbound-ID", "not-a-uuid")]),
            (
                "wrong-version",
                [("X-Phone11-Outbound-ID", "a122a69c-772a-3f8e-91e4-f6fcd4e96a53")],
            ),
            (
                "wrong-variant",
                [("X-Phone11-Outbound-ID", "a122a69c-772a-4f8e-71e4-f6fcd4e96a53")],
            ),
            (
                "duplicate-id",
                [
                    ("X-Phone11-Outbound-ID", VALID_ID_LOWER),
                    ("x-phone11-outbound-id", "b0d36227-e391-43cb-afbf-5833f4b0d144"),
                ],
            ),
        ]
        for label, headers in invalid_cases:
            packet = authenticate_and_forward(
                client,
                sink,
                label=label,
                extra_headers=headers
                + [
                    ("X-Phone11-Authenticated-User", "spoof"),
                    ("X-Phone11-Authenticated-Realm", "spoof"),
                ],
            )
            assert packet is not None
            assert_no_protected(packet)

        wrong_pilot = authenticate_and_forward(
            client,
            sink,
            label="wrong-pilot",
            username="3002",
            extra_headers=[("X-Phone11-Outbound-ID", VALID_ID_LOWER)],
        )
        assert wrong_pilot is not None
        assert_no_protected(wrong_pilot)

        non_pstn = authenticate_and_forward(
            client,
            sink,
            label="non-pstn",
            destination="*123",
            extra_headers=[("X-Phone11-Outbound-ID", VALID_ID_LOWER)],
        )
        assert non_pstn is not None
        assert_no_protected(non_pstn)

        authenticate_and_forward(
            client,
            sink,
            label="wrong-password",
            password="incorrect-password",
            extra_headers=[("X-Phone11-Outbound-ID", VALID_ID_LOWER)],
            expect_forward=False,
        )
        authenticate_and_forward(
            client,
            sink,
            label="wrong-realm",
            realm_override="wrong.realm",
            extra_headers=[("X-Phone11-Outbound-ID", VALID_ID_LOWER)],
            expect_forward=False,
        )

        print(
            "PASS: real Kamailio digest auth sanitizes and canonicalizes outbound "
            "recording metadata across 12 isolated SIP scenarios"
        )
    finally:
        client.close()
        sink.close()
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        log.close()
        if process.returncode not in (0, -signal.SIGTERM):
            with open(log_path, encoding="utf-8") as source:
                print(source.read()[-20000:])
        os.unlink(log_path)


if __name__ == "__main__":
    main()
