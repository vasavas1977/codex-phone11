# phone11 — Technical Decisions Log

## Architecture Decisions

### ADR-001: JsSIP over SRTP/SRTP for Mobile SIP

**Decision:** Use JsSIP (JavaScript SIP library) with react-native-webrtc for the mobile app.

**Context:** Needed a SIP stack that works in React Native with WebRTC for media. Alternatives were SRTP (C library, hard to integrate), Opal, or native SRTP frameworks.

**Rationale:** JsSIP is well-maintained, supports WebSocket SIP transport (RFC 7118), integrates naturally with WebRTC, and has a large community. It avoids native bridge complexity.

**Consequences:** Requires WebSocket SIP proxy (Kamailio with WSS), and RTPEngine for WebRTC-to-RTP bridging.

---

### ADR-002: Kamailio as SIP Proxy (not Opal/Asterisk)

**Decision:** Use Kamailio 5.8 as the SIP proxy/registrar with FreeSWITCH as the media/PBX server.

**Context:** Need to separate signaling from media for scalability. Asterisk combines both but doesn't scale horizontally for signaling.

**Rationale:** Kamailio handles 10,000+ registrations on a single core, supports WebSocket SIP, integrates with RTPEngine for NAT traversal, and is the industry standard for carrier-grade deployments.

**Consequences:** Two-tier architecture (Kamailio + FreeSWITCH) is more complex but scales independently.

---

### ADR-003: RTPEngine for WebRTC Media Bridging

**Decision:** Use RTPEngine (kernel-space media relay) for WebRTC↔RTP/SRTP bridging.

**Context:** Mobile WebRTC clients use DTLS-SRTP and ICE. FreeSWITCH expects plain RTP or SDES-SRTP. Need a bridge.

**Rationale:** RTPEngine handles DTLS termination, ICE, codec transcoding, and operates in kernel space for low latency. It's the standard choice with Kamailio.

**Consequences:** Requires careful flag configuration in Kamailio for offer/answer manipulation. Current DTLS role negotiation issue is a consequence of this complexity.

---

### ADR-004: Expo Router (not bare React Native)

**Decision:** Use Expo with Expo Router for the mobile app.

**Context:** Needed fast iteration, OTA updates, and file-based routing.

**Rationale:** Expo provides managed workflow, EAS Build for CI/CD, OTA updates without App Store review, and file-based routing similar to Next.js. Trade-off is slightly less control over native modules.

**Consequences:** Some native modules (CallKit, WebRTC) require custom dev client builds rather than Expo Go.

---

### ADR-005: BillRun for Billing (not Stripe/custom)

**Decision:** Use BillRun open-source BSS for all billing, rating, and CDR mediation.

**Context:** Need telecom-grade billing with per-second CDR rating, prepaid/postpaid, bundles, and multi-service convergent billing.

**Rationale:** BillRun is purpose-built for telecom operators (used by Golan Telecom, a publicly traded MVNO). It supports real-time OCS, Diameter Gy/Ro, SMPP mediation, and has zero licensing cost under AGPLv3.

**Consequences:** More complex setup than Stripe, but provides telecom-specific features that Stripe cannot (CDR rating, number portability billing, interconnect settlement).

---

### ADR-006: Single EC2 for MVP, EKS for Production

**Decision:** Deploy all services on a single EC2 instance for MVP/testing, with Terraform ready for EKS migration.

**Context:** Need to validate the full stack quickly without EKS complexity.

**Rationale:** Single EC2 with Docker Compose is fastest for iteration. Terraform modules are already written for EKS with NLB, RDS, ElastiCache — ready to apply when traffic justifies it.

**Consequences:** Current setup is not HA. Migration to EKS is a planned milestone.

---

### ADR-007: WebSocket SIP (not raw UDP from mobile)

**Decision:** Mobile app connects via WebSocket Secure (WSS) to Kamailio, not raw SIP/UDP.

**Context:** Mobile networks block or mangle SIP/UDP. Need reliable transport.

**Rationale:** WSS works through all firewalls/NATs, supports TLS encryption natively, and is the standard for browser/mobile WebRTC SIP (RFC 7118).

**Consequences:** Kamailio must listen on TCP/8088 for WSS. RTPEngine handles the media NAT traversal separately.

---

### ADR-008: Drizzle ORM (not Prisma/TypeORM)

**Decision:** Use Drizzle ORM for database access.

**Context:** Need a TypeScript ORM that is lightweight, type-safe, and fast.

**Rationale:** Drizzle has zero runtime overhead, SQL-like syntax, excellent TypeScript inference, and supports PostgreSQL natively. Lighter than Prisma (no binary engine).

**Consequences:** Less ecosystem tooling than Prisma, but better performance and smaller bundle.

---

## Operational Decisions

### OD-001: DTLS=passive on Answer (not active)

**Decision:** RTPEngine should be DTLS passive on the WebRTC (app) side.

**Context:** The app's WebRTC stack (react-native-webrtc) offers `a=setup:actpass`. RTPEngine must choose a complementary role.

**Rationale:** Standard WebRTC gateway pattern (Janus, mediasoup) is for the gateway to be passive — the browser/app drives ICE and initiates DTLS. This avoids race conditions with premature ClientHello.

**Status:** Currently broken — RTPEngine sends premature ClientHello during offer. Fix in progress.

---

### OD-002: ICE=remove on Offer, ICE=force on Answer

**Decision:** Strip ICE from the offer sent to FreeSWITCH (it doesn't need it), re-add ICE on the answer back to the app.

**Context:** FreeSWITCH doesn't participate in ICE. The app requires ICE candidates in the answer SDP.

**Rationale:** Clean separation — FreeSWITCH sees plain RTP, app sees full WebRTC SDP with ICE candidates.

**Status:** Working correctly for ICE connectivity. The issue is DTLS timing, not ICE.
