# Dedicated DID receiver contract

This pure renderer prepares the exact captured Kamailio DID route for a separate
loopback receiver at `127.0.0.1:3032`. It performs no I/O to a backend and does not
change production configuration. The port is a proposed binding, not an assertion
that a listener exists or the port is available.

The caller supplies a different, private 64-character lowercase hexadecimal
secret. Only the DID request URL, header and cache generation change beyond the
already reviewed v2 request/target convergence. Unrelated global substitutions,
routes and native lookup/relay behavior remain byte-identical. The result hides
source bytes from its repr and never declares execution eligible.

`request_transform.py` is the pinned v1 renderer with one deliberate validation
change: the old secret literal is checked as bounded source syntax, not as a
production-quality credential. `consumer_transform.py` is v2 with only the
predecessor path and hash changed. The exact original main/include/route hashes,
literal consistency, response rejection and target guards still apply. This
does not prove equality with the old backend's effective JavaScript environment.
New receiver-secret requirements remain strict. The regression suite verifies
the exact request fork delta, weak old literals, malformed rejection and new
secret validation.

Run `python3 -B -m unittest discover -s scripts/phone11-did-caller-convergence/caller-convergence-v3 -p test_transform.py`.

On 25 October, an isolated run using the installed Kamailio image accepted the
rendered configuration (`PBX-DID-DEDICATED-VENDOR-QUALIFICATION-20261025-v2.json`,
09:44 UTC). Its private candidate used a synthetic parser-only secret and MUST
NOT be deployed. The parser container was removed and protected production
identities were unchanged. The first attempt's inherited secret-quality refusal
is preserved separately; it created no test container.

Actual restricted receiver/database qualification, a fresh private matched
caller/receiver secret, endpoint availability, runtime request/target behavior
and controlled activation remain required. Parsing is not a routing or call
test. Keep the 60-second trial; Android and physical-phone tests are deferred.
