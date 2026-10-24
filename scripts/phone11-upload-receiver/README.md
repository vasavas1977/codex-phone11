# Restricted recording upload receiver

This is the exact independently reviewed upload-only candidate and bounded runner.
It is not automatically installed by the main application or release pipeline.
Running either file without its explicit runtime binding performs no host I/O.

The factory exposes `GET /health` and `POST /api/recordings/upload` only. It starts
no global workers, ESL connection, playback, auth or administrative routes. It
uses explicit database credentials with verified TLS and checks database/role
identity before listening. Upload ownership is checked before file/CDR mutation;
this is a request-time snapshot, not atomic revocation.

`runner.cjs --run-bound-upload-receiver` requires the fixed private canonical JSON
file `/run/phone11-upload-receiver/private-binding.json` (0400, runtime UID/GID,
private 0700 parent) and the exact factory under `/opt/phone11-upload-receiver/`.
It verifies factory bytes before compiling them, bounds startup to 30 seconds
and shutdown attempts to 3 seconds, and returns a failure for uncertain cleanup.
An external supervisor and separately reviewed production binding are required.
A disconnected in-flight upload is not proven drained atomically by these bounds.

The factory's dependencies resolve from `/app/package.json`; this candidate was
qualified against deployed application image `d42c70f34d5062bff779c235dd2b6e415bede3b3a86b9de73892acf35b392619`.
It contains selected installed-source functions from `57e80eca…` with reviewed
owner fix `b59cab64…`; it must not silently track changes to the main bundle.
The exact factory SHA256 is `129c1910dbb93b4663a91778e470be06bb6ed37f598605d666369b38a69f68b2`.

Validation: 15 factory and 9 runner unit cases, plus root-dispatched isolated
PostgreSQL 16.13 actual HTTP/file/job readback, replay, owner rejection, 21 SQL
denials, TLS negatives and container cleanup. These proofs do not establish
production UID1001/volume access, an installed role or public ingress selection.
The old shared legacy role remains unchanged; the voicemail owner-epoch upload
route is a different service. Keep the 60-second trial; Android and phone tests
are deferred.

Run the isolated source tests with:

```sh
node --test scripts/phone11-upload-receiver/test_receiver.cjs scripts/phone11-upload-receiver/test_runner.cjs
```
