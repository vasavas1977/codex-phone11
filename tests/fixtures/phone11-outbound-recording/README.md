# Phone11 outbound recording metadata fixture

This fixture runs a real Kamailio 5.8.4 process and a SIP digest client inside
one isolated container. Runtime networking is disabled; Kamailio, the client,
and the synthetic FreeSWITCH sink communicate only through container loopback.
No host port is published and no live configuration is mounted.

From the repository root:

```sh
docker build \
  -t phone11-outbound-recording-fixture:5.8.4 \
  tests/fixtures/phone11-outbound-recording

docker run --rm --network none --read-only --cap-drop ALL \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=8m \
  --tmpfs /var/run/kamailio:rw,nosuid,nodev,noexec,size=1m,mode=1777 \
  -v "$PWD:/work:ro" \
  phone11-outbound-recording-fixture:5.8.4 \
  python3 -B /work/tests/fixtures/phone11-outbound-recording/run.py
```

To validate an already-present private image built from the exact live image,
pass its local tag as `KAMAILIO_IMAGE` when building. Do not pull or replace a
live image as part of this fixture:

```sh
docker build \
  --build-arg KAMAILIO_IMAGE=kamailio-fixed2:5.8.4 \
  -t phone11-outbound-recording-fixture:live-base \
  tests/fixtures/phone11-outbound-recording
```

The fixture asserts real digest authentication, strict UUIDv4 validation and
lowercase canonicalization, removal of spoofed/duplicate protected headers,
pilot user and realm restrictions, PSTN-only marking, and preservation of the
Request-URI, Call-ID, and body.
