# Kamailio final-failure TM/HTTP fixture

This is a disposable runtime probe. It uses loopback UDP, synthetic SIP
identities, an in-process HTTP responder, and no production config or service.
It tests whether Kamailio 5.8 can suspend the **original transaction** from a
final failure route and add exactly one fallback branch after bounded HTTP.

The local Codex Mac had no Docker daemon and no Kamailio binary on 27 September,
so the checked-in fixture is not a runtime pass. On an isolated host with the
already-present `phone11-async-fixture:5.8.4` image, review the image and port
scope, then run from repository root:

```sh
docker run --rm --network none --platform linux/amd64 \
  -v "$PWD:/work:ro" phone11-async-fixture:5.8.4 \
  python3 /work/tests/fixtures/phone11-voicemail-fallback-tm/run.py
```

The Python runner calls `kamailio -c` first, then starts it in the container.
It exercises all-branch timeout, CANCEL before and during HTTP, late HTTP after
transaction expiry, 486-only, and a forked 486 followed by 200. Its final JSON
must show every scenario `pass`; any parser, runtime, or SIP assertion failure
is a blocker. A pass proves TM syntax/behavior in this synthetic topology only;
it does not validate live media, tenant authorization, carrier continuation,
or handset calling.
