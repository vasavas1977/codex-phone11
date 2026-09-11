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
