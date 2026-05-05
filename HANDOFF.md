# phone11 — Codex Handoff Document

## What Is Built

phone11 is a converged Unified Communications & Collaboration (UCC) platform targeting SMB/enterprise markets. It competes with Zoom Phone, 8x8, and Vonage using a 100% open-source telecom stack with zero licensing costs.

### Current State (May 2026)

| Component | Status | Notes |
|-----------|--------|-------|
| Expo/React Native iOS app | Alpha — builds and runs on device | SIP calling works, audio bug in progress |
| Kamailio SIP Proxy | Deployed on EC2 (Docker) | WebSocket SIP, TLS, RTPEngine integration |
| FreeSWITCH PBX | Deployed on EC2 (Docker) | IVR, voicemail, conferencing, PSTN bridge |
| RTPEngine | Deployed on EC2 (Docker) | NAT traversal, WebRTC-to-RTP bridging |
| Backend API (tRPC) | Implemented | Auth, PBX admin, AI analysis, recording |
| BillRun BSS | Config ready, not yet live | Billing, rating, CDR mediation |
| Marketing Website | Live at phone11ai-cqihebd7.manus.space | React 19 + Tailwind 4 |
| Terraform IaC | Written for EKS/RDS/ElastiCache | Currently running simpler EC2 Docker setup |
| Push Notifications | Flexisip config ready | FCM/APNs wake for incoming calls |

---

## Architecture

```
iOS App (Expo + JsSIP/WebRTC)
    │ WSS (SIP over WebSocket)
    ▼
Kamailio (SIP Proxy + Registrar)
    │ SIP/UDP
    ▼
FreeSWITCH (PBX + Media)
    │ SIP/RTP
    ▼
PSTN Gateway (1toall trunk)

RTPEngine handles WebRTC↔RTP bridging between Kamailio and the app.
```

### Key Infrastructure

- **EC2 Instance:** ap-southeast-7 (43.210.122.111) — runs all Docker containers
- **Containers:** p11-kamailio, p11-freeswitch, p11-rtpengine, p11-redis
- **Future:** EKS cluster with NLB, RDS PostgreSQL, ElastiCache Redis (Terraform ready)

---

## Repository Structure

```
/                         — Expo/React Native app root
├── app/                  — Expo Router pages (tabs, settings, call, chat, etc.)
├── lib/                  — Core libraries (SIP, analytics, billing, presence, etc.)
├── server/               — Backend API (tRPC routes, PBX admin, OAuth)
├── shared/               — Shared types and constants
├── infra/                — Infrastructure
│   ├── compose/          — Docker Compose for local dev
│   ├── configs/          — Kamailio, FreeSWITCH, Flexisip, RTPEngine configs
│   ├── docker/           — Dockerfiles for each service
│   ├── k8s/              — Kubernetes manifests
│   ├── monitoring/       — Grafana dashboards and alerts
│   └── terraform/        — AWS IaC (EKS, VPC, RDS, etc.)
├── deploy/               — Legacy deploy configs (Kamailio, FreeSWITCH, BillRun)
├── marketing-site/       — Public website (React 19 + Tailwind)
├── docs/                 — Documentation and diagnostics
├── tests/                — Test files
└── scripts/              — Utility scripts
```

---

## Setup & Run Instructions

### Prerequisites

- Node.js 22+, pnpm
- Docker & Docker Compose
- Expo CLI (`npx expo`)
- iOS device or simulator with Expo Go
- OpenTofu or Terraform (for infra provisioning)

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Fill in real values

# 3. Run the Expo app
npx expo start

# 4. Run infrastructure (Docker Compose)
cd infra/compose
cp env-template.txt .env
docker compose up -d

# 5. Run backend server
pnpm run dev:server
```

### Deploy to AWS

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Fill in real values
tofu init
tofu plan -out=tfplan
tofu apply tfplan
```

---

## Important Files

| File | Purpose |
|------|---------|
| `lib/sip/jssip-engine.ts` | JsSIP WebRTC SIP engine — core call logic |
| `lib/sip/native-call.ts` | iOS CallKit/CallKeep integration |
| `lib/sip/webrtc-media.ts` | WebRTC media stream management |
| `infra/configs/kamailio/kamailio.cfg` | Kamailio routing, RTPEngine flags |
| `infra/configs/freeswitch/vars.xml` | FreeSWITCH global variables |
| `infra/configs/freeswitch/dialplan/default.xml` | Call routing dialplan |
| `server/pbx/kamailio-routes.ts` | Backend API for Kamailio routing decisions |
| `server/pbx/sip-secrets.ts` | SIP credential generation (AES-256-GCM) |
| `PLATFORM_ARCHITECTURE.md` | Full system architecture document |

---

## Known Bugs

### Critical: No Audio on PSTN Calls (Active Investigation)

**Symptom:** Call connects (200 OK received), but no ringback tone and no voice audio in either direction.

**Root Cause (confirmed via logs):** RTPEngine creates an active DTLS context during `rtpengine_offer` and sends a premature ClientHello to the app. When `rtpengine_answer` arrives with `DTLS=passive`, RTPEngine resets to passive mode. The app's WebRTC stack never sends a fresh ClientHello after this role flip, so DTLS never completes and SRTP keys are never negotiated.

**Current State:** Investigating correct RTPEngine flag combination to prevent premature DTLS initiation during offer processing. See `docs/manus-diagnostics/` for full analysis.

**What NOT to redo:** The SIP signaling path (REGISTER, INVITE, 200 OK) works correctly. The issue is purely in the media/DTLS negotiation between RTPEngine and the app.

### Minor: No Local Ringback Tone

The app does not generate a local ringback tone when receiving 180 Ringing without SDP (no early media). Needs `InCallManager.startRingback()` or equivalent.

---

## Open Decisions

1. **RTPEngine DTLS strategy** — Whether to use `DTLS-reverse`, split into two call legs, or handle at the app level
2. **EKS vs EC2** — Currently on single EC2; Terraform is ready for EKS but not yet applied
3. **BillRun activation** — Config is ready but billing is not live
4. **Push notification provider** — Flexisip vs custom push gateway
5. **SRTP mode** — Whether to use DTLS-SRTP (current) or SDES for the WebRTC leg

---

## What Codex Should NOT Redo

- Do not recreate the Terraform modules — they are complete and tested
- Do not rewrite the SIP/WebRTC engine (`lib/sip/`) — it works, just needs the DTLS fix
- Do not redesign the app UI architecture — Expo Router structure is intentional
- Do not change the Kamailio routing logic — only the RTPEngine media flags need fixing
- Do not replace JsSIP — it is the correct library for React Native WebRTC SIP
- Do not recreate the marketing site — it is deployed and live
