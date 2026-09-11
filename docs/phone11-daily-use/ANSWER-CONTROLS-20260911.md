# Answer-control repair — 11 September 2026

The user reported being unable to answer. Review found two independent control defects: the in-app screen instructed the user to slide despite implementing only tap buttons, and a rejected native Answer command could escape its asynchronous listener without useful feedback. These findings do not establish the cause of the earlier incoming test, whose packet capture contained no handset response.

## Changes

- The incoming screen explicitly says **Tap Answer or Decline**. Caller details scroll; the call buttons remain in a footer that respects the phone's safe areas.
- Answer is allowed only for the actual ringing call. It shows **Answering…** after command acceptance and waits for the real connected event before opening connected controls. Repeated taps cannot re-answer an already accepted request.
- Decline remains usable while an Answer request is pending, including if the same call progresses to connecting. Missing and stale calls cannot operate another session; an ended call has a working Close action.
- Rejected in-app Answer requests remain retryable. A canceled or replaced action does not show a stale failure message.
- Controls retain the initiating authenticated owner, so an old screen cannot answer or end a new owner's reused SDK call ID. A failed Decline restores a previously pending/accepted Answer state while allowing Decline retry.
- The native system-call listener catches SDK rejections, suppresses duplicate accepted Answer actions until termination, and retains the mapping after failure for retry. It shows generic retry guidance only for the same ringing call, same authenticated owner and foreground app. It never presents raw SDK error text.

## Validation and limits

All **80 focused tests** passed across incoming/active controls, the current-call banner, native CallKit mapping and the Siprix engine. Independent review checked the owner guard and failed-Decline recovery. Physical call receipt, audio and End behavior must still be retested after installation. The existing incoming-route evidence remains in the [handset checkpoint](HANDSET-20260911.md).

No SIP routing, credentials, server NAT policy, SDK binary, native provider ownership or push commissioning flag was changed. Cold/background answering still needs its complete native wake implementation and physical acceptance; these control fixes do not enable it.

## Signed build and installation checkpoint

Signed iOS **build 17** was produced from reviewed source `b284243d86a14eb55225be0b61148184d4f969df`. Every required job passed in [GitHub run 34559119758](https://github.com/vasavas1977/codex-phone11/actions/runs/34559119758), including native checks and the mobile/chat/push database suites. EAS build: `bfa7f24c-53ea-4d34-b2b6-1da4868dd159`. The downloaded IPA's source metadata, expected bundle identifier and version 1.0.0/build 17 were verified. Size: 16,567,517 bytes; SHA256: `801b3a03c47b5cfa9054a97f280a121b15252d90384004ad553b8f0136843138`. No production Siprix license is embedded.

**Build 17 is installed.** After the user reconnected the iPhone, its pre-install inventory confirmed build 15. The verified IPA was installed in place, and an independent device inventory then confirmed version 1.0.0/build 17 with the expected bundle identifier. The earlier disconnected attempt was not counted as success despite its zero exit code. Physical incoming acceptance remains pending a bounded echo test with Phone11 open and the phone screen on. Build 16 was superseded and was not installed.

The live backend remains on `75fa3c940aa983cff30ed967d444c73b43cc9a53`. No calling route or live push configuration was changed for this repair.
