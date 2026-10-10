# Phone11 public-number audio fix — 11 September 2026

**Accepted for one bounded foreground public-number call on installed build 23.** Immediately after the matched PCMA-only test, the user confirmed **“ok working now.”** The call ended with BYE. The tested setting is retained for the dedicated Phone11 number → extension 3001. This is not acceptance of other callers/networks, background or locked calling, long licensed calls, or two-person chat.

## Change and retained scope

Two existing carrier-pilot `rtpengine_offer` branches append:

```text
codec-strip=all codec-offer=PCMA codec-offer=telephone-event
```

The [Kamailio 5.8 module](https://raw.githubusercontent.com/kamailio/kamailio/5.8/src/modules/rtpengine/README) supports these codec flags. These branches handle the carrier-to-phone offer and the same pilot dialog's phone-to-carrier re-offer. They retain PCMA as the only offered voice codec and preserve telephone-event when present. No transcoding is enabled or codec invented. Dedicated-number/trusted-source and existing dialog gates, FreeSWITCH branches, authentication, NAT, routing, RTP/SRTP transport and SDES settings remain unchanged. No application/backend deployment or database change accompanied this media setting.

| Configuration | SHA256 |
|---|---|
| Original baseline | `bb9168b3a9c312ea05267af290c3d9e581a5b31c199f905bfb410c8e986ae378` |
| Tested and retained PCMA setting | `b0d449b54b126e4e2a2b095919d39f17b395d5eec8d537c3f24803e51c47357b` |

The third-application evidence confirms the tested hash on both host and container. Exact original backups, private configuration/diff and diagnostic artifacts are preserved privately; they are not published here.

## Evidence and interpretation

The first two attempts were inconclusive and rolled back: one monitor did not match an initial call; the second failed its fresh-registration guard and never began capture. Neither establishes a codec-induced regression. Baseline tests subsequently showed substantial outgoing PCMA energy and advancing carrier reception reports despite one-way hearing. Carrier receipt and numeric energy alone did not establish intelligibility.

The third attempt deliberately restored a fresh registration and captured the selected call:

- The offer toward the phone and both answers listed PT8/101: PCMA voice plus telephone-event.
- RTP contained **1,245 outgoing** and **1,260 incoming** PCMA packets.
- Seven carrier reports matched the outgoing stream; five advanced and all reported zero loss. Reported jitter ranged **0.75–15.875 ms**.
- One transient outgoing sequence-gap/reordering observation occurred. Zero capture drops and no loss reported by the carrier do not prove absolute zero packet loss.
- BYE ended the call; the user's immediate confirmation supplies the bounded physical audio acceptance.

This supports retaining the tested interoperability setting. Asymmetric sending preferences are permitted by [RFC3264 §§6.1–7](https://www.rfc-editor.org/rfc/rfc3264.html#section-6.1); this test does not identify every internal cause of the previous silence. The separate [release checkpoint](RELEASE-CHECKPOINT.md) preserves the failed calls and remaining gates.

Before the live test, the full candidate passed exact Kamailio 5.8.4 parsing and six isolated semantic checks against the installed RTPEngine 9.4 image, including repeated codec flags, both re-offer directions and DTMF payload preservation. The diagnostic suite passed **36 tests**. These are distinct from physical hearing acceptance.

## Reproduction and recovery

1. Before any configuration change or restart, confirm the exact active hash and require zero active FreeSWITCH channels, Kamailio dialogs and relay calls. A monitor reaching its time limit is not proof of hangup. Preserve any intervening change instead of overwriting it.
2. Retain private backups and parser-check the exact intended configuration. Use only the existing narrow Kamailio configuration/restart procedure; do not reset the database, credentials, media relay or unrelated routing.
3. After a restart, deliberately re-register the pilot and require exactly one fresh contact before arming the bounded monitor. Preserve its exact scope, hash, expiry and privacy guards. Confirm PCMA negotiation, both-way hearing and actual End for each new test.
4. If recovery requires the baseline, first end the test and freshly prove idle, verify the live hash equals the expected tested hash, restore the exact private baseline with its original permissions, parser-check and restart only the affected service. Verify baseline host/container hashes, health and fresh registration. A rollback is a recovery action, not a claim that the earlier baseline one-way symptom is fixed.

The third tested setting is currently retained; no third rollback is recorded. Native/server background calling remains disabled, and production licensing, long calls, additional audio routes/networks and independent chat recipients retain their separate acceptance gates.
