# phone11 — Technical Decisions Log

## Architecture Decisions

### ADR-001: PJSIP for Native Mobile Cloud Phone

**Decision:** Use PJSIP/PJSUA2 as the native SIP engine for Phone11 mobile cloud phone calling.

**Context:** Phone11 must behave like a carrier-grade mobile softphone, with reliable SIP registration, inbound calls, hold, transfer, DTMF, native call UI, and mobile NAT handling. The Manus prototype documents mentioned JsSIP/WebRTC, but the actual mobile source already uses `react-native-pjsip`.

**Rationale:** PJSIP is purpose-built for SIP/RTP on iOS and Android and aligns better with Phone11's telecom-operator architecture than browser-style WebRTC SIP. It keeps PSTN/cloud-phone calling close to the carrier stack while allowing meetings/video to use a separate SFU path.

**Consequences:** The app needs native builds, CallKit/ConnectionService integration, and proper PJSIP licensing for a commercial closed-source product. LiveKit/WebRTC remains the plan for meetings and group video, not the primary mobile PSTN calling engine.

---

### ADR-002: Kamailio as SIP Proxy (not Opal/Asterisk)

**Decision:** Use Kamailio 5.8 as the SIP proxy/registrar with FreeSWITCH as the media/PBX server.

**Context:** Need to separate signaling from media for scalability. Asterisk combines both but doesn't scale horizontally for signaling.

**Rationale:** Kamailio handles 10,000+ registrations on a single core, supports WebSocket SIP, integrates with RTPEngine for NAT traversal, and is the industry standard for carrier-grade deployments.

**Consequences:** Two-tier architecture (Kamailio + FreeSWITCH) is more complex but scales independently.

---

### ADR-003: RTPEngine for SIP Media Anchoring

**Decision:** Use RTPEngine as the carrier media relay for SIP/RTP/SRTP anchoring, NAT traversal, recording forks, and SBC interoperability.

**Context:** Mobile clients, customer networks, AWS NAT, FreeSWITCH, and external SBCs all require predictable media anchoring. Even when the app uses native SIP/PJSIP instead of JsSIP/WebRTC, RTPEngine remains important for NAT traversal and operational visibility.

**Rationale:** RTPEngine is the standard Kamailio media relay choice and supports the relay behavior needed for mobile SIP clients, PSTN trunks, and recording/AI pipelines.

**Consequences:** Requires careful AWS NAT configuration: bind RTPEngine to the EC2 private address and advertise the Elastic/public address to clients.

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

### ADR-007: SIP TLS First for Native Mobile

**Decision:** Phone11 native mobile should use SIP over TLS by default, with TCP/UDP available for controlled testing and WSS reserved for future browser clients or compatibility cases.

**Context:** Mobile networks often block or mangle SIP/UDP. A production mobile app needs reliable encrypted signaling while staying compatible with carrier SIP infrastructure.

**Rationale:** SIP TLS is the natural transport for PJSIP-based native apps. It avoids forcing the phone product through a browser WebRTC signaling model.

**Consequences:** Kamailio must expose and monitor SIP TLS cleanly. WSS can still be added later for web softphone support.

---

### ADR-008: Drizzle ORM (not Prisma/TypeORM)

**Decision:** Use Drizzle ORM for database access.

**Context:** Need a TypeScript ORM that is lightweight, type-safe, and fast.

**Rationale:** Drizzle has zero runtime overhead, SQL-like syntax, excellent TypeScript inference, and supports PostgreSQL natively. Lighter than Prisma (no binary engine).

**Consequences:** Less ecosystem tooling than Prisma, but better performance and smaller bundle.

---

## Operational Decisions

### OD-001: AWS NAT Media Advertisement

**Decision:** In AWS, RTPEngine must bind to the EC2 private address and advertise the Elastic/public address.

**Context:** EC2 instances do not own the public Elastic IP on the host interface. Binding RTPEngine directly to the public IP can fail with media port allocation errors.

**Rationale:** RTPEngine supports separate bind and advertised addresses. This matches AWS networking and prevents call setup failures caused by binding to an address that is not present on the host.

**Status:** Repo configuration has been updated in the production compose path; live server rollout still requires secure server access.

---

### OD-002: Meetings Use LiveKit, Phone Uses PJSIP

**Decision:** Do not force one media stack to do everything. Phone11 cloud phone uses PJSIP/SIP; meetings and group video use LiveKit/WebRTC.

**Context:** Zoom Phone and Zoom Meetings are related products but have different media requirements. Phone11 should copy that separation internally while presenting one app to the customer.

**Rationale:** PJSIP gives stronger telecom/SIP behavior for PSTN calling. LiveKit gives the right SFU primitives for meetings, rooms, screen sharing, and group video.

**Status:** Locked product architecture for the Phone11 UCC app.
