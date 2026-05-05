# phone11 — Full Project Inventory

## Environments

| Environment | Location | Access |
|-------------|----------|--------|
| EC2 Production | ap-southeast-7 (43.210.122.111) | SSH via deploy key |
| Marketing Site | phone11ai-cqihebd7.manus.space | Manus webdev hosting |
| Future EKS | ap-southeast-1 (Terraform ready) | Not yet provisioned |

---

## Running Services (EC2 Docker)

| Container | Image | Ports | Role |
|-----------|-------|-------|------|
| p11-kamailio | ghcr.io/kamailio/kamailio:5.8.4-bookworm | 5060/UDP, 8088/TCP (WSS) | SIP proxy, WebSocket, registrar |
| p11-freeswitch | safarov/freeswitch:latest | 5080/UDP (internal SIP) | PBX, IVR, conferencing, recording |
| p11-rtpengine | phone11ai-rtpengine:latest | 20000-30000/UDP | WebRTC↔RTP media relay |
| p11-redis | redis:7-alpine | 6379/TCP | Cache, presence, session store |

---

## Codebase Components

### Mobile App (Expo/React Native)

| Directory | Contents |
|-----------|----------|
| `app/` | 16 route groups: tabs, call, chat, conference, contacts, settings, admin, billing, DID, messages, notifications, oauth, portal, recording, voicemail, dev |
| `lib/sip/` | JsSIP engine, WebRTC media, native CallKit, audio routing, account store |
| `lib/analytics/` | Call analytics and AI-powered diarization |
| `lib/billrun/` | BillRun BSS client integration |
| `lib/chat/` | Real-time messaging |
| `lib/conference/` | Multi-party conferencing |
| `lib/did/` | DID number management |
| `lib/notifications/` | Push notification engine |
| `lib/presence/` | User presence (online/busy/away) |
| `lib/recording/` | Call recording management |
| `lib/transfer/` | Call transfer (blind/attended) |
| `hooks/` | React hooks: auth, color scheme, PBX admin |
| `components/` | Reusable UI components |
| `constants/` | App constants, OAuth config, theme |

### Backend Server

| Directory | Contents |
|-----------|----------|
| `server/_core/` | LLM integration, OAuth, SDK, type definitions |
| `server/pbx/` | PBX admin router, Kamailio routes, SIP secrets, recording storage, WebSocket, tenant middleware |
| `server/phone-provisioning.ts` | Phone number provisioning |
| `server/push-gateway.ts` | Push notification gateway |

### Infrastructure

| Directory | Contents |
|-----------|----------|
| `infra/terraform/` | AWS IaC: VPC, EKS, NLB, RDS, ElastiCache, ECR, S3, security groups, monitoring |
| `infra/terraform/modules/` | Modular: ecr, eks, elasticache, monitoring, nlb, rds, s3, security-groups, vpc |
| `infra/compose/` | Docker Compose for local development |
| `infra/configs/kamailio/` | kamailio.cfg, tls.cfg, TLS certs (removed from repo) |
| `infra/configs/freeswitch/` | Full FreeSWITCH config: vars, dialplan, directory, SIP profiles, autoload |
| `infra/configs/flexisip/` | Flexisip push gateway config |
| `infra/docker/` | Dockerfiles for backend, flexisip, freeswitch, kamailio |
| `infra/k8s/` | Kubernetes base manifests |
| `infra/monitoring/` | Grafana dashboards (call quality, infrastructure, push, SIP) + alert rules |

### Deploy (Legacy)

| Directory | Contents |
|-----------|----------|
| `deploy/kamailio/` | Docker Compose + kamailio.cfg for standalone deploy |
| `deploy/freeswitch/` | Docker Compose + dialplan + DID routing Lua script |
| `deploy/billrun/` | Docker Compose + BillRun config + MongoDB init + rating rules |

### Marketing Site

| Directory | Contents |
|-----------|----------|
| `marketing-site/` | React 19 + Tailwind 4 + shadcn/ui website |

### Documentation

| File | Contents |
|------|----------|
| `PLATFORM_ARCHITECTURE.md` | Full system architecture (investor-grade) |
| `infra/DEPLOYMENT.md` | Deployment guide (Docker Compose + K8s) |
| `infra/terraform/MANUS_DEPLOY_INSTRUCTIONS.md` | Terraform deployment steps |
| `deploy/DEPLOYMENT_GUIDE.md` | Legacy deployment guide |
| `design.md` | App design document |
| `docs/manus-diagnostics/` | Troubleshooting reports from Manus sessions |

---

## External Dependencies

| Service | Purpose | Status |
|---------|---------|--------|
| 1toall (SIP trunk) | PSTN connectivity | Active |
| AWS (EC2, future EKS) | Hosting | Active |
| Apple APNs | iOS push notifications | Config ready |
| Firebase FCM | Android push notifications | Config ready |
| BillRun | Billing/BSS | Config ready, not live |

---

## Database Schema

Located in `drizzle/schema.ts` with migrations in `drizzle/0000_elite_eternals.sql`. Uses PostgreSQL via Drizzle ORM.

---

## Test Files

| File | Coverage |
|------|----------|
| `tests/ai-analysis.test.ts` | AI call analysis |
| `tests/auth.logout.test.ts` | Authentication logout |
| `tests/diarization-analytics.test.ts` | Speaker diarization |
| `tests/notifications.test.ts` | Push notifications |
| `tests/presence.test.ts` | User presence |
| `tests/quick-msg-contacts-presence.test.ts` | Quick messaging |
| `tests/speaker-correction-transfer.test.ts` | Call transfer |
