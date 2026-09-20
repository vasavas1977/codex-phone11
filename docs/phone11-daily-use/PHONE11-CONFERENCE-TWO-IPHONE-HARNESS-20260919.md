# Phone11 two-iPhone conference acceptance harness

This is a manual, nonproduction acceptance run for the signed Phone11 build
`ab6de8f0-a31a-4caf-ad5a-8c2962c3dc87`. It records what two physical iPhones
show and hear; it does not create a meeting, call a provider, mint a token, or
change a server, database, EAS project, or production route.

The recorder accepts only local operator evidence. It never accepts or emits
credentials, provider room names, provider identities, SIP URIs, or endpoints.
If any of those appear in a note, the report replaces them with `[REDACTED]`.
Use generic wording such as “Phone A showed Connected” and “Phone B heard the
remote test tone.” Do not paste screenshots or logs containing a token or
provider coordinate into the evidence file.

## Prepare the run

1. Use two physical iPhones, labelled **Phone A** and **Phone B**, with the
   same signed build ID above installed. Record the app version shown in the
   app/settings screen on each phone. Simulator, web preview, and source tests
   do not pass the device gates.
2. Use two separately authorized members of the same nonproduction test
   workspace. Confirm each member is admitted to the same test meeting by the
   Phone11 UI. The operator must not enter a room name, media identity, token,
   credential, SIP URI, or provider URL.
3. Start with no SIP call on either phone. Keep ordinary Phone11 voice-call
   acceptance separate from this meeting run.
4. Print an empty evidence file with:

   ```sh
   node scripts/phone11-conference-acceptance-harness.mjs --template > conference-evidence.json
   ```

   Fill in only the device version/build/install fields and the PASS/FAIL
   observation notes. A completed report is generated with:

   ```sh
   node scripts/phone11-conference-acceptance-harness.mjs \
     --input conference-evidence.json \
     --output conference-report.json
   ```

   Exit status 0 means every required observation passed; status 1 means the
   report contains a FAIL; status 2 means the local evidence file could not be
   read. The command performs no network calls.

## Device and media sequence

Record each item as PASS only when the stated observation was visible or
audible on the physical phones. Otherwise record FAIL with a short generic
reason.

| Check ID                            | Operator action and PASS evidence                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorized_two_member_join`        | Phone A and Phone B each join the same meeting as their own authorized member; both show a server-confirmed connected state and the expected two-member roster.                                                                                                            |
| `local_remote_av`                   | With camera and microphone intentionally enabled, each phone publishes its own camera/mic and receives the other phone’s live video and audio. Confirm the local preview and remote tile independently.                                                                    |
| `listener_receive_only`             | Re-run with the listener member. The listener receives the remote audio/video while microphone and camera controls are unavailable and no listener media is published.                                                                                                     |
| `permission_denied_receive_only`    | Deny microphone and camera permissions on the listener phone. It still receives the remote media, remains receive-only, and shows no false local publication or permission bypass.                                                                                         |
| `reconnect`                         | During an active meeting, interrupt the test network briefly. Both phones show Reconnecting, then return to Connected with the correct roster and media; a stale disconnected room is not resurrected.                                                                     |
| `background_foreground`             | Background each phone and return it to the meeting. The app shows the expected reconnect/media state, then restores only the streams allowed by the member role and current permissions.                                                                                   |
| `sip_conference_boundary`           | With a meeting active, a SIP call attempt is blocked until the meeting is finished, or an incoming SIP event first stops meeting tracks and audio and then gives SIP ownership. After the SIP call, the meeting does not resume silently; the operator explicitly rejoins. |
| `leave_cleanup`                     | Leave from each phone. Local camera/mic tracks stop, the room is disconnected, the participant disappears, active meeting state is cleared, and a later SIP call has no meeting media competing for audio.                                                                 |
| `eviction_disconnect_remint_denial` | In the isolated test environment, evict one member. That phone disconnects, its old lease cannot be reused, and a new join/remint attempt is denied until a fresh authorized admission exists. Record only the UI result and generic operation outcome.                    |
| `no_auto_dispatch`                  | Joining or reconnecting starts no interpreter, translation worker, voice bot, or agent. Any such feature must be separately enabled and visibly ready; ordinary meeting admission remains video/audio only.                                                                |

The harness also requires two separate installation/version checks. Each phone
must have `installed: true`, a nonempty displayed app version, and the exact
build ID above. A build QR, source revision, or test result without the app
being installed on that physical phone is a FAIL.

## Review the report

The report is accepted only when both device checks and all ten matrix checks
are `PASS`, with no entries in `failures`. Keep the JSON report with the test
date, operator, and nonsecret generic notes. Treat it as handset acceptance
evidence only: it does not prove provider deployment, production routing,
credentials, database state, or a customer-facing release.

The active Phone11 source lifecycle already defines the SIP boundary used by
this checklist: joining rejects a live SIP call, and a SIP interruption leaves
the meeting and releases tracks/audio before SIP becomes eligible. If the
physical result differs, record the first failing check and stop the run before
changing routing or credentials.
