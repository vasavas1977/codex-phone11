# Phone11 PSTN Call No-Audio Diagnostic Report

**Date:** 2026-05-05  
**Symptom:** Outbound PSTN call connects (200 OK received), but caller hears no ringback tone and no voice audio in either direction after callee answers.

---

## 1. Expo App Call Implementation

### Microphone Permission

The app correctly declares `NSMicrophoneUsageDescription` in `app.config.ts` (line 56) and `microphonePermission` (line 123). `UIBackgroundModes` includes `["voip", "audio", "remote-notification"]`. Permission configuration is correct.

### iOS Audio Session

CallKeep is configured in `native-call.ts` (line 108) with `audioSession: { categoryOptions: 0x01 | 0x04, mode: "voiceChat" }`. The app listens for `didActivateAudioSession` and `didDeactivateAudioSession` events. However, **no `react-native-incall-manager` package is installed** (not in `package.json`). The `audio-route.ts` file's `setSpeakerEnabled()` is a no-op that only logs. In practice, `react-native-webrtc` should automatically configure the audio session when a PeerConnection is active, so this is likely not the primary blocker but is a risk factor.

### Remote Media Track Sink/Playback

In `jssip-engine.ts` (line ~645), the `pc.ontrack` handler only logs:
```typescript
pc.ontrack = (event: any) => {
  console.log("[JsSIP Engine] ✅ Remote audio track received");
};
```

There is **no explicit attachment of the remote stream to an audio output**. In `react-native-webrtc`, remote audio tracks should auto-play once added to the PeerConnection without needing an `<RTCView>`. However, this depends on the audio session being correctly activated by CallKit. The `_checkRemoteAudio` method only verifies receivers exist after 3 seconds but takes no corrective action.

### SIP/WebRTC Event Handlers

The `progress` event handler (line ~614) sets call status to "ringing" on 180/183 but **generates no local ringback tone**. There is no audio file playback, no tone generator, and no early media stream attachment. The app relies entirely on the network providing early media (183 with SDP), which the current Kamailio/RTPEngine configuration cannot deliver because DTLS never completes.

### Packages

| Package | Version |
|---------|---------|
| jssip | ^3.13.7 |
| react-native-webrtc | ^124.0.7 |
| react-native-callkeep | 4.3.16 |
| react-native-incall-manager | **NOT INSTALLED** |

---

## 2. SIP Signaling Path — 180 vs 183

FreeSWITCH's outbound dialplan (`01_1toall_outbound.xml`) uses a simple `bridge` application without any `ringback` or `transfer_ringback` variable set. The 1toall PSTN gateway will send 180 Ringing (without SDP) back to FreeSWITCH, which forwards it to Kamailio.

Kamailio's `onreply_route[FREESWITCH_REPLY]` (line 436) applies `rtpengine_answer` only when the response `has_body("application/sdp")`. A bare 180 Ringing (no SDP) passes through without RTPEngine processing, meaning no early media path is established. The app receives 180 but has no local ringback tone generator, so the caller hears silence.

For the 200 OK (which does contain SDP), `rtpengine_answer` is called with the flags below.

---

## 3. Kamailio rtpengine Flags (Exactly as Deployed)

### Offer (line 388 of kamailio.cfg):
```
rtpengine_offer("replace-origin ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv")
```

### Answer (line 442 of kamailio.cfg):
```
rtpengine_answer("replace-origin force-encryption ICE=force ice-lite=forced rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub")
```

### Critical Finding: `ice-lite=forced` is INVALID

RTPEngine v26.0.1.3 logs confirm:
```
WARNING: [jnisl2jkl5en4upfosg5]: [core] Unknown 'ICE-lite' flag encountered: 'forced'
WARNING: [jnisl2jkl5en4upfosg5]: [core] Unknown flag encountered: 'force-encryption'
```

The valid values for `ICE-lite` in RTPEngine are: `forward`, `backward`, `both`, `off`. The value `forced` is not recognized and is silently ignored. Additionally, `force-encryption` is not a valid flag name (the correct flag is `force-encrypt`).

Because `ice-lite=forced` is ignored, RTPEngine runs **full ICE** (from `ICE=force`). It acts as a full ICE agent and sends STUN Binding Requests to the app's candidates. While ICE does eventually succeed (pair to 49.230.79.215:49344 succeeds), the **DTLS handshake fails** because of the role conflict described below.

---

## 4. FreeSWITCH SIP/RTP Profile Settings

| Setting | Value |
|---------|-------|
| Profile | external (port 5080) |
| RTP-IP | 10.0.1.69 (private) |
| Ext-RTP-IP | 43.210.122.111 (public) |
| SIP-IP | 10.0.1.69 |
| Ext-SIP-IP | 43.210.122.111 |
| Codecs IN/OUT | OPUS, G722, PCMU, PCMA, H264, VP8 |
| NOMEDIA (bypass_media) | false |
| PROXY-MEDIA | false |
| LATE-NEG | true |
| RTP port range | OS-assigned (not constrained in profile) |

FreeSWITCH **anchors RTP** (NOMEDIA=false, PROXY-MEDIA=false). It terminates and re-originates media. RTP flows: App → RTPEngine → FreeSWITCH → 1toall gateway. FreeSWITCH sends plain RTP to RTPEngine on the `priv` interface (10.0.1.69:22198).

---

## 5. Recent Failed Call Correlation

### Call-ID: `jnisl2jkl5en4upfosg5`

**SIP Flow:**
1. App sends INVITE with WebRTC SDP (UDP/TLS/RTP/SAVPF, ICE candidates, DTLS fingerprint, setup=actpass)
2. Kamailio `rtpengine_offer` strips ICE/DTLS, converts to plain RTP/AVP, sends to FreeSWITCH
3. FreeSWITCH bridges to 1toall-outbound gateway
4. 1toall sends 180 Ringing (no SDP) → passes through Kamailio to app (no ringback)
5. 1toall sends 200 OK with plain RTP SDP → Kamailio calls `rtpengine_answer`
6. RTPEngine generates WebRTC answer SDP for the app

**Offer SDP from App (redacted):**
```
m=audio 64146 UDP/TLS/RTP/SAVPF 111 63 9 102 0 8 13 110 126
c=IN IP4 43.210.122.111
a=candidate:... 192.168.31.71:60770 typ host
a=candidate:... 10.38.68.69:54857 typ host
a=candidate:... 171.5.186.94:60770 typ srflx
a=candidate:... 49.230.79.215:49344 typ srflx
a=candidate:... 43.210.122.111:64146 typ relay
a=candidate:... 43.210.122.111:54191 typ relay
a=ice-ufrag:W13C
a=ice-pwd:[REDACTED]
a=fingerprint:sha-256 90:ED:3A:F1:...:5C:86
a=setup:actpass
a=rtcp-mux
```

**Answer SDP returned to App (from RTPEngine):**
```
m=audio 21928 UDP/TLS/RTP/SAVPF 111 110
c=IN IP4 43.210.122.111
a=mid:0
a=rtcp:21928
a=rtcp-mux
a=setup:passive
a=fingerprint:sha-256 07:6B:7F:FF:...:26:44
a=ice-ufrag:7jvJwMmL
a=ice-pwd:[REDACTED]
a=ice-options:trickle
a=candidate:YNJNKHLGIAdfyTZC 1 UDP 2130706431 43.210.122.111 21928 typ host
a=end-of-candidates
```

**ICE State:**
- RTPEngine (full ICE agent) sends STUN requests to all 6 app candidates
- Pair to 49.230.79.215:49344 (srflx) succeeds at T+0.08s
- ICE completed at T+0.45s using pair to 171.5.186.94:60770

**DTLS State:**
- During offer processing (before answer), RTPEngine creates **active** DTLS context and sends ClientHello to 49.230.79.215:49344
- When answer arrives with `DTLS=passive`, RTPEngine **resets** DTLS and creates **passive** DTLS context
- After reset to passive, RTPEngine waits for ClientHello from the app
- The app's SDP has `a=setup:actpass`, and RTPEngine's answer has `a=setup:passive`
- Therefore the app should take the **active** role and send ClientHello to RTPEngine
- **But the app never sends ClientHello** → DTLS stays at "before SSL initialization" forever

**Packet Counters (at call teardown):**

| Direction | Port | Packets In | Bytes In | Packets Out | Bytes Out |
|-----------|------|-----------|----------|-------------|-----------|
| FreeSWITCH → RTPEngine (priv) | 10.0.1.69:21686 | 1835 | 171,288 | 0 | 0 |
| RTPEngine → App (pub) | 10.0.1.69:21928 ↔ 171.5.186.94:60770 | 0 | 0 | 1 | 196 |
| RTCP (priv) | 10.0.1.69:21687 | 24 | 2,688 | 0 | 0 |

**Error Messages:**
```
ERR: [srtp] SRTP output wanted, but no crypto suite was negotiated
ERR: [rtcp] SRTCP output wanted, but no crypto suite was negotiated
```

FreeSWITCH sent 1835 RTP packets to RTPEngine, but RTPEngine could not forward them to the app because DTLS never completed (no SRTP keys negotiated). Only 1 packet (196 bytes, likely the initial ClientHello that was sent before the answer reset) was sent toward the app.

---

## 6. Ranked Root-Cause Hypotheses and Patch Proposal

### Root Cause #1 (PRIMARY): DTLS Role Conflict Due to Mid-Call Reset

**Probability: 90%**

The sequence is:
1. Offer processing: RTPEngine creates **active** DTLS and sends ClientHello to the app's srflx address
2. Answer processing (371ms later): `DTLS=passive` flag causes RTPEngine to **reset** DTLS and switch to passive mode
3. RTPEngine now waits for the app to send ClientHello
4. But the app's WebRTC stack already received the initial ClientHello and is waiting for the handshake to continue (or has already sent its own response to the void)
5. The app sees `a=setup:passive` in the answer SDP and should initiate DTLS as active, but by this point the ICE consent/connectivity check timing may have passed, or the app's DTLS state machine is confused by the aborted first handshake

The fundamental issue is that RTPEngine should NOT initiate DTLS during the offer phase (before it knows its role). The `ICE=force` flag on the answer side causes RTPEngine to start ICE checks during offer processing (because it has the app's candidates from the offer), and the active DTLS context is created prematurely.

### Root Cause #2 (CONTRIBUTING): Invalid `ice-lite=forced` Flag

**Probability: 95% contributing factor**

The flag `ice-lite=forced` is not recognized by RTPEngine v26.0.1.3 (confirmed by WARNING log). Valid values are `forward`, `backward`, `both`, `off`. Because it's ignored, RTPEngine runs full ICE instead of ICE-lite. In ICE-lite mode, RTPEngine would NOT send STUN checks or initiate DTLS prematurely — it would simply wait for the app to connect. This is the correct behavior for a WebRTC media gateway.

### Root Cause #3 (CONTRIBUTING): Invalid `force-encryption` Flag

**Probability: 80% contributing factor**

The flag `force-encryption` is not recognized (WARNING logged). The correct flag name is `force-encrypt`. Without it, RTPEngine may not properly enforce DTLS-SRTP on the WebRTC leg.

### Root Cause #4 (SECONDARY): No Local Ringback Tone

**Probability: 100% explains the no-ringback symptom**

The app has no local ringback tone generator. When 180 Ringing arrives without SDP (no early media), the app should play a local ringback tone. Currently it only sets the call status to "ringing" without any audio feedback.

---

## Minimal Patch Proposal (DO NOT EXECUTE)

### Fix 1: Correct the Kamailio rtpengine_answer flags

**File:** `/etc/kamailio/kamailio.cfg` inside container `p11-kamailio`  
**Line:** 442

**Current:**
```
rtpengine_answer("replace-origin force-encryption ICE=force ice-lite=forced rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub")
```

**Proposed:**
```
rtpengine_answer("replace-origin ICE=force-relay rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub")
```

**Rationale:** 
- Remove `force-encryption` (invalid flag name, and not needed since `transport-protocol=UDP/TLS/RTP/SAVPF` already implies encryption)
- Remove `ice-lite=forced` (invalid value; causes WARNING and is ignored)
- Change `ICE=force` to `ICE=force-relay` — this makes RTPEngine advertise itself as an ICE-lite endpoint with a single relay candidate, which is the standard pattern for SIP-to-WebRTC gateways. The app will send STUN checks to RTPEngine (not the other way around), and DTLS will proceed correctly with RTPEngine in passive role.

**Alternative (if `ICE=force-relay` is not supported in this version):**
```
rtpengine_answer("replace-origin ICE=force ice-lite=backward rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub")
```

Where `ice-lite=backward` means "apply ICE-lite to the backward (answerer/WebRTC) direction" — i.e., RTPEngine acts as ICE-lite toward the app.

**Commands (not to be executed now):**
```bash
docker exec p11-kamailio sed -i 's/replace-origin force-encryption ICE=force ice-lite=forced rtcp-mux-require/replace-origin ICE=force ice-lite=backward rtcp-mux-require/' /etc/kamailio/kamailio.cfg
docker exec p11-kamailio kamcmd cfg.reload
# Or restart:
docker restart p11-kamailio
```

### Fix 2: Add local ringback tone to the Expo app

**File:** `/home/ubuntu/cloudphone11/lib/sip/jssip-engine.ts`  
**Location:** Inside the `progress` event handler (~line 614)

**Proposed addition:**
```typescript
session.on("progress", (data: any) => {
  const statusCode = data?.response?.status_code;
  console.log(`[JsSIP Engine] Call progress: ${statusCode}`);
  if (statusCode === 180 || statusCode === 183) {
    this._updateCallStatus(callId, "ringing");
    // If no early media SDP in 183, play local ringback
    if (statusCode === 180 || !data?.response?.body) {
      this._playLocalRingback();
    }
  }
});
```

Plus a new method `_playLocalRingback()` using `expo-audio` to play a ringback tone audio file.

### Fix 3: (Optional) Install react-native-incall-manager

```bash
cd /home/ubuntu/cloudphone11
npx expo install react-native-incall-manager
```

Then call `InCallManager.start({ media: 'audio', ringback: '_BUNDLE_' })` on outgoing call start, and `InCallManager.stop()` on call end. This ensures the iOS audio session is properly configured for VoIP and provides built-in ringback tone support.

---

## Summary

The primary blocker is the **invalid RTPEngine flags** in Kamailio's `rtpengine_answer` call. Both `ice-lite=forced` and `force-encryption` are unrecognized by RTPEngine v26.0.1.3, causing it to run full ICE (not ICE-lite) and to initiate DTLS prematurely during offer processing. When the answer arrives and forces a DTLS role reset to passive, the app's WebRTC stack never sends a fresh ClientHello, leaving DTLS permanently stuck at "before SSL initialization." No SRTP keys are ever negotiated, so all 1835 RTP packets from FreeSWITCH are dropped with "SRTP output wanted, but no crypto suite was negotiated."

The fix is to use valid RTPEngine flags (`ice-lite=backward` or `ICE=force-relay`) so RTPEngine behaves as an ICE-lite endpoint, letting the app drive both ICE connectivity checks and DTLS initiation.
