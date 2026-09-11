# In-app Answer and audio activation — 11 September 2026

## Physical build 18 evidence

The owner confirmed readiness with Phone11 open on the physical iPhone. A bounded direct echo call reached extension 3001 through the existing proxy, bypassing the public carrier. A private device screenshot during ringing showed the system incoming-call banner and Phone11's visible Tap to answer banner.

The owner reported **connected, but echo missing or unclear**. Independent evidence narrows that result:

- The persisted handset trace records Incoming Answer tapped with eligible=true, followed by Siprix Answer requested and command accepted. This establishes the in-app Answer path for this attempt.
- Signaling records 180 Ringing at 07:52:41.262 UTC, successful INVITE answer at 07:52:50.241, and received BYE at 07:53:07.446. The app recorded its own hang-up request immediately before the BYE.
- Independent FreeSWITCH logs and XML CDR confirm answer, echo execution, approximately 17 seconds connected, NORMAL_CLEARING and recv_bye. The phone ended the call before either test safety cleanup or the guard could terminate it.
- The CDR reports PCMA at 8000 Hz but **zero RTP packets and zero raw media bytes in both directions**. The echo application received no voice to send back. A default MOS value with zero packets is not audio-quality evidence.

Ringing, in-app Answer signaling and phone-initiated End are established for this attempt. Audio failed. Public-number delivery and background/locked receipt remain separate gates. The signaling-only capture does not independently measure RTP; the zero-media evidence comes from the exact-call server CDR.

## Source defect and correction

The in-app provider directly invoked the SIP SDK's answer method. On iOS, the SDK is configured for externally managed CallKit audio. Reporting an incoming call as connected did not submit a system answer action; the existing iOS report helper only performed a real connected-report operation for outgoing calls. Thus this path could accept SIP signaling while bypassing the system answer transaction that starts the call audio session.

The installed CallKeep source implements answerIncomingCall by submitting a CXAnswerCallAction. Its provider delegate configures audio, emits the Answer callback and fulfills the action; its audio-activation callback is forwarded to the SIP engine. This matches the [CallKeep answer API](https://github.com/react-native-webrtc/react-native-callkeep#answerincomingcall) and Apple's explanation that [CallKit activates call audio through the system](https://developer.apple.com/videos/play/wwdc2016/230/).

The correction routes the in-app iOS Siprix Answer action through the system answer transaction. The native Answer handling remains responsible for SDK acceptance, with duplicate protection and owner/call binding. Audio activation follows the actual CallKit callback; no manual activation bypass or second audio provider is introduced. Independent review covered retries, duplicate taps, pending/end/reset cleanup, owner changes, same-ID replacement calls and callbacks arriving after timeout. All 147 focused tests passed, including 31 native mapping/answer tests and 14 actual provider-hook tests. The local iOS JavaScript export also passed. Audible handset acceptance remains required after a new signed build is installed.

System caller labels now use the parsed caller number/name instead of displaying a raw SIP server URI. Routing retains the original URI. Bounded diagnostics distinguish the system answer request, actual CallKit audio activation, SDK forwarding and the native audio-session event; incoming SIP connection no longer implies that CallKit activated audio.


## Signed build 19 installed

Exact source `aba6ff24f6ebebd688c51dc669fd213cdae3d44b` passed every required job in [GitHub run 34577365729](https://github.com/vasavas1977/codex-phone11/actions/runs/34577365729). EAS build `05e5e98f-a61e-4532-b7d3-06c3bd68a877` produced version 1.0.0/build **19**. The downloaded IPA source, bundle and version matched; its 16,572,596-byte SHA256 is `08e42e4fe9da52097b143838ca7342aeeac22674db7edbf5f200dfefbf7045d5`. Installation succeeded and independent paired-device inventory confirmed build 19.

No production SDK license is embedded. The live backend remains on `75fa3c940aa983cff30ed967d444c73b43cc9a53`; background calling remains uncommissioned. Build 19 passed the bounded foreground direct echo test below after renewed physical readiness, using the in-app Answer button. Native audio-activation diagnostics establish only that the bridge ran, not that media flowed or that a person heard clear audio.

## Build 19 physical acceptance

On 11 September the owner confirmed **connected, clear echo, and End worked**. The private ringing screenshot shows Phone11's incoming screen with Answer and Decline. Persisted handset events establish the repaired path: in-app Answer at 08:21:05.675 UTC, system answer transaction at 05.683, native Answer callback and SDK acceptance at 05.731–05.734, then actual CallKit audio activation and SDK forwarding at 05.838–05.839. SIP connection followed, and the app requested hang-up at 08:21:11.057. Audio deactivation followed normal call termination.

Independent exact-call server logs and CDR confirm ringing, answer at 08:21:06.275, echo execution and received BYE/NORMAL_CLEARING at 08:21:11.115, approximately 4.84 seconds after answer. PCMA/8000 media flowed: 239 packets received and 237 sent, versus zero in both directions on build 18. These packet counts corroborate media transport; the owner's clear-echo report supplies audible acceptance. The accepted 55-second safety guard and final cleanup did not end the call.

The post-call physical screen returned to Ready to call and displayed phone11-test in the recent list. This passes the bounded foreground in-app Answer, clear echo and handset End test on build 19. It does not establish public-number delivery, locked/background receipt, long-call licensing, every audio route, or two-person chat.
