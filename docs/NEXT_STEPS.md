# phone11 — Recommended Next Engineering Tasks

## Priority 1: Fix Audio (Critical Path)

### 1.1 Resolve DTLS Handshake Failure

**Problem:** RTPEngine initiates DTLS ClientHello during `rtpengine_offer` (active role), then switches to passive on `rtpengine_answer`. The app never sends a fresh ClientHello after the role flip.

**Approaches to try (in order):**

1. **Use `DTLS-reverse=passive` on the offer line** — This tells RTPEngine "the DTLS offered to me is passive" which should prevent it from initiating active DTLS during offer processing. Combine with removing ICE-lite from the answer line.

2. **Use two separate RTPEngine call legs** — Create one plain RTP leg for FreeSWITCH and a separate WebRTC leg for the app, so the WebRTC leg is only created at answer time when the DTLS role is known.

3. **Use `DTLS=no` on offer, `DTLS=passive` on answer** — Completely suppress DTLS during offer processing.

4. **App-side fix** — If the app receives a premature ClientHello, ensure it can still initiate its own ClientHello when the answer arrives with `a=setup:passive`.

**Files to modify:**
- `infra/configs/kamailio/kamailio.cfg` (lines 388 and 442)
- Potentially `lib/sip/jssip-engine.ts` if app-side DTLS handling needs adjustment

---

### 1.2 Implement Local Ringback Tone

**Problem:** App receives bare 180 Ringing (no SDP/early media). No audible feedback to caller.

**Fix:** In `lib/sip/jssip-engine.ts`, on the `progress` event with status 180 and no body, call `InCallManager.startRingback()` or play a local audio file.

**Files:** `lib/sip/jssip-engine.ts`, `lib/sip/native-call.ts`

---

## Priority 2: Production Readiness

### 2.1 Migrate to EKS

- Apply existing Terraform in `infra/terraform/`
- Set up NLB with UDP passthrough for SIP/RTP
- Configure pod anti-affinity for Kamailio/FreeSWITCH
- Set up RDS PostgreSQL and ElastiCache Redis
- Move from Docker Compose to K8s manifests in `infra/k8s/`

### 2.2 Enable Push Notifications

- Deploy Flexisip push gateway container
- Configure APNs certificate and FCM key
- Test incoming call wake on iOS (VoIP push)
- Integrate with CallKit for native incoming call UI

### 2.3 Activate BillRun Billing

- Deploy BillRun Docker stack from `deploy/billrun/`
- Configure CDR mediation from FreeSWITCH
- Set up rating rules for voice minutes
- Integrate with app billing UI (`app/billing/`)

---

## Priority 3: Feature Completion

### 3.1 Call Recording

- FreeSWITCH recording is configured
- Need S3 upload pipeline (`server/pbx/recording-storage.ts`)
- Playback UI in `app/recording/`

### 3.2 Conferencing

- FreeSWITCH conference rooms configured
- Need app UI for creating/joining conferences (`app/conference/`)
- Moderator controls (mute, kick)

### 3.3 Chat/Messaging

- Backend ready (`lib/chat/`)
- Need real-time WebSocket transport
- Message persistence in PostgreSQL

### 3.4 DID Number Management

- UI exists (`app/did/`)
- Need integration with number provider API
- BillRun monthly rental billing

---

## Priority 4: Quality & Operations

### 4.1 Monitoring

- Deploy Grafana dashboards from `infra/monitoring/dashboards/`
- Set up alert rules from `infra/monitoring/alerts/`
- Add call quality metrics (MOS, jitter, packet loss)

### 4.2 Testing

- Expand test coverage (currently 7 test files)
- Add E2E call flow tests
- Add SIP registration stress tests
- Add SRTP/DTLS negotiation unit tests

### 4.3 CI/CD

- Set up EAS Build for iOS/Android
- GitHub Actions for backend deployment
- Terraform plan/apply pipeline
- Automated security scanning

---

## Do NOT Start From Scratch

The following are complete and working — extend, don't replace:

- Terraform modules (VPC, EKS, NLB, RDS, ElastiCache, ECR, S3, monitoring)
- Kamailio routing logic (only media flags need fixing)
- FreeSWITCH dialplan and directory
- JsSIP SIP engine (call signaling works)
- App UI architecture (Expo Router with 16 route groups)
- BillRun configuration and rating rules
- Marketing website
