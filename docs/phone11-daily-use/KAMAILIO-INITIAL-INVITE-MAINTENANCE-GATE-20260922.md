# Phone11 Kamailio initial-INVITE maintenance gate

**Status:** source prerequisite complete; host commissioning and production
activation not performed.

## Result

`infra/configs/kamailio/kamailio.cfg` now contains one disabled-by-default
maintenance htable and one gate immediately before the initial INVITE branch.
The state does not exist at startup. While its integer value is later than
Kamailio's current epoch, Kamailio returns `503 Temporarily Unavailable` for
every out-of-dialog INVITE before authentication, location lookup, DID API
lookup, dispatcher selection or media allocation.

The established-dialog path and CANCEL still exit before this gate. REGISTER,
OPTIONS, SUBSCRIBE, PUBLISH and MESSAGE do not match it. ACK, BYE and a routed
in-dialog re-INVITE keep their existing path. The change does not edit the
FreeSWITCH configuration, routing destinations, provider settings, media
routes or backend/wake bytes.

`scripts/phone11-kamailio-maintenance-controller.py` uses Kamailio's existing
local JSON-RPC FIFO and the `htable.setxs` operation to set
`expiry_epoch:operation_uuid` and its TTL together. The route reads only the
expiry field, while controller status and release require the complete value.
This prevents an old receipt from claiming or releasing a later activation
that happens to have the same expiry. The controller accepts only 180 through
1,800 seconds, rejects a second active operation, and never shortens an active
gate. Its activation evidence is written only after exact readback and a second
identity check.

Activation and release records are canonical JSON, create-only, mode `0600`
files under a pre-created root-owned mode `0700` directory. They bind the
operation UUID, expiry, exact config and controller hashes, interpreter hash,
Kamailio executable hash and process start identity, and FIFO inode identity.
A daemon restart, config/controller change, FIFO replacement, state mismatch,
expiry or RPC failure cannot report an active fence.

If an activation RPC fails after the set may have reached Kamailio, the
controller deletes the state only when readback still carries that operation's
exact UUID-bound value, then verifies absence before returning the original
failure. A competing value is preserved. If that restore cannot be proved, it
returns `activation_restore_ambiguous` and writes no activation evidence. The
htable TTL remains the availability backstop for a hard controller crash. An
explicit release verifies the same activation record and identities, deletes
only the expected state, verifies absence, and writes a separate immutable
release record. All controller instances for the daemon also serialize through
the fixed root-owned
`/run/lock/phone11-kamailio-maintenance-controller.lock`, not through a
caller-selected evidence directory.

## Source validation

Run the focused suite from the repository root:

```sh
python3 tests/phone11-kamailio-maintenance-controller.test.py
```

The suite covers the default-off route, all listed initial-INVITE destination
classes, preservation of ACK/BYE/CANCEL/re-INVITE/REGISTER/OPTIONS/SUBSCRIBE/
PUBLISH/MESSAGE, activation, no premature release before expiry, expiry,
duplicate activation, RPC timeout after a possible set, ambiguous restore,
competing-writer preservation, same-expiry stale-receipt rejection, CLI wiring,
identity drift, evidence-write failure, foreign state, exact release and
evidence tampering.

## Commissioning gate

Do not add this controller to `guard.program` or a production rollout manifest
from source evidence alone. Before any live use, the telephony owner must:

1. Parse the exact rendered production config with the pinned Kamailio 5.8.8
   image and record the config digest. No parser run was possible in this source
   workspace because the pinned image was unavailable and the local Docker
   daemon was not running.
2. Establish the reviewed execution location. The tracked production Compose
   file does not expose `/var/run/kamailio` to the host, while the controller
   intentionally requires local FIFO access and Linux `/proc` identity. Pin the
   installation path, Python runtime, Kamailio PID/executable digest, config
   path/digest, FIFO and reply directory. Do not improvise a mutable wrapper or
   restart Kamailio to activate the gate.
3. Run the controller against a staged daemon and inject FIFO unavailable,
   response timeout, process restart, config drift, controller drift, foreign
   htable state, evidence-write failure and helper termination after the RPC.
   Confirm that the route admits new calls at the recorded expiry even if the
   htable expiry timer has not yet removed the stale item.
4. Prove with real SIP traffic that new PSTN, registered-extension, DID,
   queue/ring-group/IVR, conference, voicemail and emergency INVITEs receive
   the reviewed 503 without wake, lookup or media work. Establish a dialog
   before activation and prove ACK, BYE, CANCEL and re-INVITE behavior, plus
   unchanged registration, OPTIONS and presence traffic.
5. Keep the separate edge mutation gate and aggregate
   `phone11-profile-dnd-guard/v1` controller work distinct. This SIP evidence
   covers only `sip_invite_admission`; it cannot authorize the profile/DND
   baseline replacement by itself. The aggregate controller must keep both
   edge and SIP controls active, require the same evidence digest through stop,
   restart and rollback, and require at least the rollout operator's remaining
   150-second lifetime at every protected phase.
6. During the authorized maintenance window, activate with a fresh UUID and a
   duration that covers drain, replacement and rollback margin. Release only
   after the replacement receipt and independent healthy-call proof. Archive
   both records without editing or reusing them.

No live daemon, host file, provider, call, deployment, migration, edge gate or
production process was changed while preparing this source prerequisite.
