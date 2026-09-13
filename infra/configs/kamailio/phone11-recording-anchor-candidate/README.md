# Disabled recording-anchor candidate

No existing deployed configuration includes these files. This candidate affects
only an explicitly configured carrier source and the existing pilot DID allowlist:
`020303001`, `6620303001`, and `+6620303001`. This is the same anchored exact
allowlist as the existing trusted pilot route. All other forms stay on their
existing route; no prefix or fuzzy-number matching is used.

Required private Kamailio definitions:

- `WITH_PHONE11_RECORDING_ANCHOR`
- `PHONE11_ANCHOR_CARRIER_IP` (verified carrier IP)
- `PHONE11_ANCHOR_FS_IP` (verified FS source IP)
- `PHONE11_ANCHOR_FS_PORT` (`5080` after verification)
- `PHONE11_ANCHOR_FS_URI` (`sip:phone11-recording-3001@10.0.1.69:5080`)

Include routes.inc and insert `route(PHONE11_RECORDING_ANCHOR)` after existing
initial Record-Route setup and before the current pilot initial INVITE branch.
Keep existing matching CANCEL/transaction handling before this hook.
Inside the existing validated `is_known_dlg()` / `loose_route()` block, insert
`route(PHONE11_RECORDING_ANCHOR_DIALOG)` BEFORE all generic media handling.
It bypasses RTPengine only for the dedicated A dialog, which never allocates it.
All other dialogs continue unchanged. Do not install only the initial hook.

FS source candidates are in `../../freeswitch/phone11-recording-anchor-candidate`.
Install public-entry.xml before general outbound rules, and context.xml as a
separate dialplan context only after parser review. The source guard and fixed
bridge use verified current private host `10.0.1.69`; revalidate deployment IPs.
The initial leg must reach external/public, and media must remain at FS.
No early `answer` is issued. The returned B leg is accepted only from the exact
FS socket with the marker and fixed extension; it enters the existing wake flow.
That new leg's SIP Call-ID is the wake link and recording identity. Do not carry
an A-leg wake identity across the bridge.

Media paths: carrier RTP ↔ FS; FS ↔ existing RTPengine FS-origin priv/pub path ↔
Phone11. Re-INVITEs on the A leg stay untouched, consistent with its initial SDP.
Existing FS-origin RTPengine behavior applies to the B leg. Config checks do not
prove packet reachability or two-way audio; a supervised call must verify both,
announcement, hangup, repeat incoming calls, and actual recording before release.

Isolated checks (no published ports or production network):

```
docker build -t phone11-anchor-fixture:local tests/fixtures/phone11-recording-anchor
docker run --rm --network none -v "$PWD:/work:ro" phone11-anchor-fixture:local python3 tests/fixtures/phone11-recording-anchor/run.py
docker run --rm --network none -v "$PWD:/work:ro" phone11-anchor-fixture:local python3 tests/fixtures/phone11-recording-anchor/xml-check.py
```

The fixture runs actual Kamailio with synthetic FS and device SIP endpoints.
It covers forwarding, new B-leg identity/wake boundary, A-leg ACK/re-INVITE/BYE,
pre-answer CANCEL, spoof/loop refusal, and unchanged nonpilot/emergency routing.
It does not run real FreeSWITCH, the wake HTTP service, or RTP audio.
