# RTPEngine Diagnosis - Call k1sgfgmpn64gh8auipic

## Key Findings:

### 1. FreeSWITCH → RTPEngine (WORKING)
- Port 28554 on priv interface (10.0.1.69)
- Receiving RTP from FreeSWITCH at 10.0.1.69:26596
- 752 packets in, 68896 bytes - FreeSWITCH IS sending audio
- **0 packets OUT** - RTPEngine is NOT forwarding to the app!

### 2. App → RTPEngine (BROKEN - ICE FAILED)
- Port 22278 on pub interface (10.0.1.69, advertised as 43.210.122.111)
- App peer: 49.230.79.164:45066
- **0 packets IN** from app, 755 errors
- Only 1 packet OUT (196 bytes) - likely a STUN response
- 76 seconds total

### 3. ICE FAILURE
- RTPEngine tried ICE to **10.41.132.41:60980** (app's PRIVATE carrier NAT IP!)
- This is the SDP c= address from the app's offer
- ICE candidate pair set as **FAILED** after 25 seconds
- RTPEngine never tried the app's public IP 49.230.79.164!

### 4. DTLS Never Started
- DTLS stuck at "before SSL initialization" forever
- Because ICE failed, no media path was established
- DTLS can't start without a working media path

## Root Cause:
ICE=force in the answer direction makes RTPEngine generate ICE candidates and do ICE negotiation with the app. But RTPEngine is trying to reach the app at its **private carrier IP** (10.41.132.41) from the app's SDP, instead of the app's **public IP** (49.230.79.164).

The app's SDP has:
- c=IN IP4 10.41.132.41 (private carrier NAT)
- a=candidate with srflx to 49.230.79.164 (public IP)

RTPEngine is only trying the host candidate (10.41.132.41) which is unreachable from the server.

## Fix Options:
1. **Remove ICE=force from answer** - Don't do ICE on the app side, just use the received-from IP
2. **Use `media-address=` flag** to force RTPEngine to use the app's received-from IP
3. **Use `NAT-wait` or similar** to let RTPEngine learn the app's real IP from incoming packets
4. **Try `ICE=force-relay`** to force relay candidates only
