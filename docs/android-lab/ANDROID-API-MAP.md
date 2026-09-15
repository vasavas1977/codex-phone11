# Android shared bridge mapping

Official source: Siprix SampleJava revision80d198ed6179b45ff8cd8dad9b8086976b4197a0. The actual AAR's classes were inspected with `javap`; SHA256 and trial duration are pinned in `lab/android/sdk-lock.json`. SDK1.1.0 build20260905_1222. iOS remains1.0.40.

| JS | Actual Android vendor API | State / failure |
|---|---|---|
| initialize / destroy | SiprixCore.initialize(IniData) / unInitialize() | Check return code; failed destroy preserves state; generation invalidates queued callbacks only after success |
| getSnapshot | Bridge-owned callback state + getVersion / dvcGetSelAudioDevice | No fake registration/call success |
| createAccount | AccData setters + accountAdd(data,IdOutArg) | One synthetic7101 only, fixed lab media profile, account ownership checked |
| register/unregister/delete | accountRegister / accountUnregister / accountDelete | RegState callback controls status; delete rejects live calls |
| makeCall | callInvite(DestData,IdOutArg) | Dialing is request state; connected only from callback; allowlisted local destinations |
| answer / reject / hangup | callAccept / callReject(486) / callBye | Commands accepted separately from peer state; duplicates pending are idempotent |
| mute | callMuteMic | Command-acknowledged state only; peer audio must independently verify mute |
| hold/resume | callHold (vendor toggle) | Pending toggle guard; state from onCallHeld |
| DTMF | callSendDtmf | Digits validated; receiving fixture observation needed |
| speaker | dvcSetAudioDevice / dvcGetSelAudioDevice | Reject unavailable route; callback/snapshot reports observed route |
| events | ISiprixModelListener | Serialized callback queue, generation and sequence, no SIP response text logged |
| wake/binding/completed wake history | No Android implementation commissioned | E_UNSUPPORTED; cannot pass L3 |
| handleNativeAudioSession | iOS CallKit-specific | E_UNSUPPORTED on Android |

No success-returning wake stubs. RN addListener/removeListeners satisfy the event emitter bookkeeping contract; they are not telephony commands. Video/transfer/conference/SMS remain outside this single-call lab envelope. Lab TLS is explicitly unsupported; no trust verification is disabled. Do not interpret local UDP/PCMA evidence as production SRTP/TLS interoperability.
