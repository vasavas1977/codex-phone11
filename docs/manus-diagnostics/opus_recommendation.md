# Claude Opus 4.7 Recommendation - RTPEngine ICE/DTLS Fix

## Root Cause
With `ICE=force` (full ICE), RTPEngine parses every candidate in the app's SDP, including `10.41.132.41` (host) and `49.230.79.164` (srflx). It sends STUN binding requests to ALL of them from its own socket. The host candidate is unreachable from AWS → STUN times out.

## The Fix: ICE-lite

With **ICE-lite**, RTPEngine:
1. Sends only one candidate (its public IP `43.210.122.111:port`)
2. Sets `a=ice-lite`
3. Waits passively. The browser does its own checks against RTPEngine's single candidate
4. DTLS ClientHello arrives on that same 5-tuple → handshake proceeds

## Correct Flags

### Offer (App → FreeSWITCH):
```
replace-origin ICE=remove rtcp-mux-demux transport-protocol=RTP/AVP DTLS=off SDES=off direction=pub direction=priv
```

### Answer (FreeSWITCH → App):
```
replace-origin force-encryption ICE=force ice-lite=forced rtcp-mux-require transport-protocol=UDP/TLS/RTP/SAVPF DTLS=passive SDES=off generate-mid direction=priv direction=pub
```

## Key Changes:
1. **`ice-lite=forced`** - THE KEY FIX. Makes RTPEngine act as ICE-lite peer
2. **`force-encryption`** - Ensures SRTP toward app even if FS side is plain RTP
3. **`generate-mid`** - iOS WebKit may reject SDP without `a=mid`
4. **`transport-protocol=UDP/TLS/RTP/SAVPF`** - Full WebRTC transport protocol
5. **Remove `replace-session-connection`** - Deprecated in v26, `replace-origin` handles it
6. **Add `DTLS=off`** to offer - Explicitly no crypto toward FS
