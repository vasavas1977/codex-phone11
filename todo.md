# CloudPhone11 TODO

## Branding & Setup
- [x] Generate CloudPhone11 app logo
- [x] Apply logo to all required icon locations
- [x] Update theme colors (electric blue + emerald green)
- [x] Update app.config.ts with app name and branding

## Navigation & Structure
- [x] Set up 5-tab navigation (Dialpad, Recents, Contacts, Messages, Settings)
- [x] Add all tab icons to icon-symbol.tsx
- [x] Create all screen route files

## Dialpad Screen
- [x] 12-key dial pad with haptic feedback
- [x] Number input field with backspace
- [x] Voice call button and video call button
- [x] Recent numbers quick-dial strip
- [x] SIP registration status indicator

## Recents (Call Log) Screen
- [x] Grouped call history (Today, Yesterday, Older)
- [x] Call type icons (incoming, outgoing, missed)
- [x] Tap to call back, long press options
- [x] Missed calls in red

## Contacts Screen
- [x] Searchable contacts list with alphabetical index
- [x] Favorites section
- [x] Add contact FAB button
- [x] Contact detail screen with call/message/video actions

## Messages Screen
- [x] Thread list with unread badges
- [x] Individual message thread screen
- [x] SIP MESSAGE protocol integration (simulated)
- [x] File attachment support UI

## Active Voice Call Screen
- [x] Full-screen dark in-call UI
- [x] Mute, hold, speaker, keypad, transfer controls
- [x] End call (red) button
- [x] Call timer

## Incoming Call Screen
- [x] Full-screen incoming call UI
- [x] Caller name/number display
- [x] Accept (green) / Decline (red) buttons
- [x] CallKit / ConnectionService integration notes

## Video Call Screen
- [x] Full-screen video with local PiP preview
- [x] Camera flip, mute mic, mute video, end call controls

## Voicemail Screen
- [x] Voicemail inbox list
- [x] Playback controls
- [x] Transcription display

## IVR Builder Screen
- [x] Visual IVR flow builder
- [x] Greeting, menu, route-to-extension nodes
- [x] Export dial plan config

## Settings Screens
- [x] SIP Account setup (server, port, username, password, transport)
- [x] Audio settings (codec priority, echo cancel, noise suppress)
- [x] Notification settings
- [x] IVR Builder link
- [x] About / Backend architecture docs screen

## Backend Architecture Documentation
- [x] FreeSWITCH configuration guide
- [x] Kamailio SIP proxy setup
- [x] Flexisip push gateway setup
- [x] PSTN / SIP trunk integration guide
- [x] liblinphone SDK integration guide

## BillRun BSS Integration
- [x] Platform architecture document (PLATFORM_ARCHITECTURE.md)
- [x] DID number management screen (browse, purchase, manage numbers)
- [x] BillRun billing portal screen (balance, invoices, plans, usage)
- [x] Settings screen updated with Billing & Numbers section
- [x] BillRun API integration map (accounts, subscribers, balances, autorenew, CDR)
- [x] MVNO SIM billing architecture documented
- [x] DID provisioning microservice architecture documented
- [x] Kamailio ↔ BillRun real-time call authorization flow documented

## Phase 2 — Real SIP Calling (PJSIP + Kamailio + Dinstar SBC)
- [x] Install react-native-pjsip or pjsip2 npm package
- [x] Create SIP engine service (lib/sip/engine.ts) with init, register, unregister
- [x] Create SIP call manager (lib/sip/call-store.ts) with makeCall, hangup, hold, mute, transfer
- [x] Create SIP account store (lib/sip/account-store.ts) with AsyncStorage persistence
- [x] Wire SIP registration status to Dialpad screen indicator
- [x] Wire SIP call state to Active Call screen (real timer, mute/hold state)
- [x] Wire SIP incoming call event to Incoming Call screen
- [x] Add CallKit (iOS) / ConnectionService (Android) native module integration
- [x] Add Kamailio server config fields to SIP Settings screen
- [x] Add Dinstar SBC STUN/ICE config to Audio Settings screen
- [x] Add SRTP/ZRTP encryption toggle wired to PJSIP

## Phase 2 — BillRun Billing API Integration
- [x] Create BillRun API client (lib/billrun/client.ts) with auth and base URL config
- [x] Create BillRun hooks: useBalance, useInvoices, useUsage, usePlans
- [x] Replace mock balance data in Billing screen with live BillRun /billapi/accounts
- [x] Replace mock invoices with live BillRun /billapi/bills
- [x] Replace mock usage with live BillRun /billapi/lines CDR aggregation
- [x] Add BillRun server URL and API key to secrets
- [x] Add error handling and loading states for all billing API calls

## Phase 2 — DID Provisioning Integration
- [x] Create DID provider API client (lib/did/client.ts) supporting DIDww or DIDx
- [x] Create useAvailableDIDs hook with country/type filter and real number search
- [x] Create usePurchaseDID hook wired to BillRun subscriber autorenew
- [x] Create useMyDIDs hook for active number management
- [x] Replace mock DID data in DID screen with live provider API data
- [x] Add DID provider API key to secrets
- [x] Wire DID purchase to BillRun billing (create charge on purchase)

## Phase 3 — Deployment Scripts & Server Config
- [x] BillRun Docker Compose deployment script (docker-compose.yml + setup.sh)
- [x] Kamailio SIP proxy configuration for CloudPhone11
- [x] FreeSWITCH PBX and IVR configuration
- [x] Server config screen in app for entering connection details
- [x] Deployment README with step-by-step instructions

## Phase 4 — CallKit / ConnectionService Integration
- [x] Create native call manager module (lib/sip/native-call.ts)
- [x] Add CallKit configuration for iOS (incoming call UI on lock screen)
- [x] Add ConnectionService configuration for Android (incoming call UI)
- [x] Wire incoming SIP call events to native call notification
- [x] Handle call accept/decline from lock screen
- [x] Handle call end from native call UI
- [x] Add VoIP push notification handler for background call wake

## Phase 4 — Admin Web Portal
- [x] Create admin portal page structure (app/admin/)
- [x] Dashboard screen with live call stats, active users, revenue metrics
- [x] Extensions management (CRUD, assign DID, set voicemail)
- [x] User/subscriber management (add, edit, suspend, billing status)
- [x] DID inventory management (pool, assign, release, import)
- [x] IVR flow management (create, edit, deploy to FreeSWITCH)
- [x] Call analytics & CDR viewer (search, filter, export)
- [x] System health monitoring (Kamailio, FreeSWITCH, BillRun status)

## Phase 5 — Team Chat & Presence
- [x] Create presence engine (lib/presence/engine.ts) with SIP SIMPLE subscribe/notify
- [x] Create presence store (lib/presence/store.ts) with online/busy/away/offline states
- [x] Create team chat types and data models (lib/chat/types.ts)
- [x] Create chat store (lib/chat/store.ts) with channels, DMs, messages
- [x] Build Team Chat tab screen with channels list and DM list
- [x] Build chat room screen with real-time message bubbles and input
- [x] Build channel creation screen (name, members, type)
- [x] Add presence status indicators to Contacts screen
- [x] Add presence status indicators to Recents screen
- [x] Add user presence status selector (online/busy/away/dnd) to Team Chat header
- [x] Update tab navigation to include Team Chat tab (6 tabs)

## Phase 6 — Customer Self-Service Portal
- [x] Create portal directory structure (app/portal/)
- [x] Portal dashboard — account overview, balance, active services summary
- [x] Account profile — edit name, email, phone, company, password
- [x] Billing & invoices — view balance, pay invoices, download PDF, auto-pay toggle
- [x] DID number management — browse, purchase, release, configure forwarding
- [x] Call forwarding rules — set forwarding by time, status, or unconditional
- [x] Usage analytics — voice minutes, SMS count, data usage, cost breakdown
- [x] Voicemail management — listen, download, delete, greeting upload
- [x] Support & tickets — submit tickets, view history, FAQ
- [x] Add portal entry point from Settings screen

## Phase 7 — Conference Bridge
- [x] Create conference types and data models (lib/conference/types.ts)
- [x] Create conference store with Zustand (lib/conference/store.ts)
- [x] Create FreeSWITCH conference engine (lib/conference/engine.ts)
- [x] Build conference room screen with participant grid and moderator controls
- [x] Build conference list screen (active, scheduled, recent conferences)
- [x] Add Meet Now button to Keypad screen
- [x] Add participant invite flow (from contacts or manual dial)
- [x] Add moderator controls: mute all, unmute all, kick participant, record
- [x] Add conference info panel (PIN, duration, participant count)
- [x] Add conference icons to icon-symbol.tsx
- [x] Add conference entry point from Settings or dedicated screen

## Phase 8 — Call Recording & Playback
- [x] Create recording types and data models (lib/recording/types.ts)
- [x] Create recording engine for FreeSWITCH server-side recording (lib/recording/engine.ts)
- [x] Create recording store with Zustand (lib/recording/store.ts)
- [x] Add recording indicator to Active Call screen
- [x] Add recording playback UI to Recents screen (REC badge, play button, mini-player, Recorded filter)
- [x] Build recording detail screen with full playback controls (waveform, speed, skip ±15s, transcription, notes)
- [x] Add recording search and filter (by date, contact, duration, direction)
- [x] Add recording download and share functionality
- [x] Add FreeSWITCH recording configuration to deploy scripts
- [x] Add recording icons to icon-symbol.tsx (play, pause, stop already mapped)

## Phase 9 — AI Call Transcript Analysis
- [x] Create AI analysis types (lib/recording/ai-types.ts) — topics, summary, sentiment, action items
- [x] Create AI transcript analysis engine (lib/recording/ai-engine.ts) — topic extraction, summarization, sentiment, action items
- [x] Update recording store with AI analysis state and actions
- [x] Update recording detail screen with AI Insights section (summary, topics, sentiment, action items)
- [x] Add AI analysis to mock recording data for demo (auto-analyzes on screen open)
- [x] Add AI analysis icons to icon-symbol.tsx (all needed icons already mapped)

## Phase 10 — Push Notifications (Missed Calls & Voicemail)
- [x] Create push notification types and data models (lib/notifications/types.ts)
- [x] Create Flexisip push gateway engine (lib/notifications/engine.ts) — FCM/APNs registration, token management
- [x] Create notification store with Zustand (lib/notifications/store.ts) — notification list, unread count, preferences
- [x] Build notification center screen (app/notifications/index.tsx) — grouped by time, mark read, dismiss, clear all
- [x] Add notification preference settings screen (app/notifications/preferences.tsx) — per-category toggles, sound, vibration, quiet hours, Flexisip info
- [x] Wire missed call events to push notification dispatch (store.dispatchMissedCall)
- [x] Wire new voicemail events to push notification dispatch (store.dispatchVoicemail)
- [x] Add notification bell icon with unread badge to Keypad header
- [x] Add Flexisip push gateway configuration to deploy scripts (deploy/flexisip-push-gateway.md)
- [x] Add notification-related icons to icon-symbol.tsx (person.crop.circle.fill, questionmark.circle.fill)
- [x] Write unit tests for notification types and data models (9 tests passing)

## Phase 11 — Speaker Diarization
- [x] Create diarization types (lib/recording/diarization-types.ts) — speaker segments, speaker labels, timestamps
- [x] Create diarization engine (lib/recording/diarization-engine.ts) — text parsing with speaker detection + mock generation
- [x] Update recording store with diarization state and actions
- [x] Update recording detail screen with speaker-attributed transcript (color-coded chat bubbles, speaker stats bars, talk % visualization, turn/overlap metrics)
- [x] Auto-diarize on screen open with per-speaker sentiment scores
- [x] Write unit tests for diarization types (5 tests passing)

## Phase 12 — Call Analytics Dashboard
- [x] Create analytics types (lib/analytics/types.ts) — metrics, time series, aggregations
- [x] Create analytics aggregation engine (lib/analytics/engine.ts) — call volume, sentiment trends, topics, speakers, action items
- [x] Create analytics store (lib/analytics/store.ts) — Zustand with time range selection and refresh
- [x] Rebuilt admin analytics dashboard (app/admin/analytics.tsx) — metrics grid, call volume chart, sentiment trend, sentiment distribution, top topics, action items summary, top speakers, direction distribution, hourly distribution
- [x] Wired analytics entry points from Settings (Usage Analytics + Call Analytics rows) and Admin portal
- [x] Write unit tests for analytics types (5 tests passing, 10 total)

## Phase 13 — Manual Speaker Label Correction
- [x] Add speaker correction types to diarization-types.ts (SpeakerCorrection, SegmentReassignment, DiarizationCorrections)
- [x] Add renameSpeaker and reassignSegment actions to recording store (with stat recalculation)
- [x] Add editable speaker label UI to recording detail screen (tap speaker stat to rename modal, long-press bubble to reassign modal)
- [x] Corrections stored in Zustand state with full history tracking
- [x] Write unit tests for speaker correction types (5 tests passing)

## Phase 14 — Call Transfer & Forwarding UI
- [x] Create transfer types (lib/transfer/types.ts) — blind/attended transfer, targets, favorites, history
- [x] Create transfer engine (lib/transfer/engine.ts) — blind REFER, attended hold+consult+complete, favorites, history
- [x] Create transfer store (lib/transfer/store.ts) — Zustand with sheet visibility, active transfer, favorites, history
- [x] Build transfer screen (app/call/transfer.tsx) — favorites, recents, keypad entry tabs
- [x] Build attended transfer consultation screen — connected/ringing status, complete/cancel buttons
- [x] Wire transfer button into active call screen — navigates to /call/transfer with callId
- [x] Call forwarding rules already exist in portal/forwarding.tsx
- [x] Transfer icons already mapped (arrow.triangle.2.circlepath, person.2.fill, checkmark.circle.fill, xmark.circle.fill)
- [x] Write unit tests for transfer types (5 tests passing, 10 total in file)

## Phase 15 — Contact Presence Status for Call Transfer
- [x] Create presence types (lib/presence/types.ts) — 7 statuses (online/busy/away/dnd/ringing/offline/unknown), BLF dialog state mapping, color/label/priority config
- [x] Enhanced presence engine (lib/presence/engine.ts) — SIP SUBSCRIBE/NOTIFY, BLF monitoring, extension-based subscriptions, weighted random state transitions, display names
- [x] Enhanced presence store (lib/presence/store.ts) — extension-based subscriptions, getExtensionStatus, sortByAvailability, lastUpdated for reactive re-renders
- [x] Updated transfer screen with presence indicators (colored dots on avatars, status chips, presence legend, sort toggle)
- [x] Updated transfer favorites and recents with presence dot overlays and status chips
- [x] Added presence-aware sorting (available contacts first, toggle button in header)
- [x] Write unit tests for presence types (7 tests passing — config, colors, labels, priority sorting, BLF mapping)

## Phase 16 — Show Active Call Details for Busy Contacts
- [x] Extend presence types with ActiveCallInfo (remotePartyName, remotePartyNumber, direction, startedAt, isInternal) + formatCallDuration helper
- [x] Update presence engine with generateMockActiveCall — 10 mock remote parties, realistic durations, auto-generates on busy/ringing transitions
- [x] Update presence store with getActiveCall(extension) action returning ActiveCallInfo
- [x] Update transfer screen with ActiveCallRow component — direction icon, remote party name (bold), internal badge, live duration counter (1s tick)
- [x] ActiveCallRow shown on both favorites and recents rows when contact is busy/ringing
- [x] Write unit tests for ActiveCallInfo and formatCallDuration (6 new tests, 13 total passing)

## Phase 17 — Quick Message to Busy Contacts from Transfer Screen
- [x] Add quick-message button (chat icon) on busy/ringing contact rows in transfer screen
- [x] Build compose modal with 6 preset quick messages, custom text input (200 char limit), and horizontal scrollable presets
- [x] Add send confirmation with success haptics, checkmark animation, and auto-close after 1.5s
- [x] Wire message dispatch with send button and keyboard submit
- [x] Write unit tests for quick-message presets (3 tests passing)

## Phase 18 — Contact Presence on Main Contacts Tab
- [x] Subscribe to presence for all 8 contacts on Contacts tab mount via subscribeExtensions
- [x] Add live presence dot overlay on contact avatar (color-coded, hollow for offline)
- [x] Add presence status chip with dot + label next to contact name
- [x] Add sort-by-availability toggle button in header (By Status / Sort)
- [x] Show active call info row for busy/ringing contacts with direction, remote party, and live duration + presence legend bar

## Branding — Logo Update
- [x] Copy user-provided logo to all required icon locations (icon.png, splash-icon.png, favicon.png, android-icon-foreground.png)
- [x] Upload logo to S3 and update app.config.ts logoUrl

## Phase 19 — Deployment Infrastructure (Docker & Kubernetes)
- [x] Create infrastructure directory structure (infra/docker, infra/configs, infra/compose, infra/k8s)
- [x] Create FreeSWITCH Dockerfile with call recording, conferencing, and TLS config
- [x] Create Kamailio Dockerfile with SIP proxy, load balancing, WSS, and TLS config
- [x] Create Flexisip Dockerfile with push gateway for FCM/APNs + entrypoint.sh
- [x] Create backend API Dockerfile (multi-stage Node.js production build)
- [x] Create FreeSWITCH configs (internal/external SIP profiles, dialplan with recording/voicemail/conferencing, modules.conf.xml)
- [x] Create Kamailio config (kamailio.cfg — registrar, auth, dispatcher, NAT, presence/BLF, WSS, anti-flood)
- [x] Create Flexisip config (flexisip.conf — FCM/APNs push, Redis registration, DoS protection)
- [x] Create Docker Compose for local dev (7 services + RTPEngine, health checks, volumes)
- [x] Create Docker Compose for production (resource limits, logging, restart policies)
- [x] Create Kubernetes namespace, ServiceAccount, Role, RoleBinding
- [x] Create K8s deployments (PostgreSQL StatefulSet, Redis, FreeSWITCH hostNetwork, Kamailio 2-replica, Flexisip, Backend 2-replica)
- [x] Create K8s services (ClusterIP for internal, NLB LoadBalancer for Kamailio SIP)
- [x] Create K8s ConfigMaps, Secrets, and TLS Secret
- [x] Create K8s Ingress with nginx + cert-manager for API and WSS
- [x] Create K8s PVCs (PostgreSQL 50Gi gp3, Redis 10Gi, Recordings 200Gi EFS, Voicemail 50Gi EFS)
- [x] Create K8s HPAs (Backend 2-10, Kamailio 2-6) + PodDisruptionBudgets
- [x] Env template (env-template.txt) + init-db.sql with Kamailio/CDR schema
- [x] Create comprehensive DEPLOYMENT.md (architecture, quick start, K8s guide, monitoring, backup, troubleshooting, security checklist)
- [x] CI/CD deferred — infrastructure configs ready for manual or pipeline deployment

## Phase 20 — Terraform IaC for AWS Deployment
- [x] Create Terraform directory structure (infra/terraform/ with modules/)
- [x] Create main.tf with AWS, Kubernetes, Helm providers + all module wiring
- [x] Create variables.tf with 25+ configurable inputs
- [x] Create VPC module (2 AZs, public/private subnets, NAT gateways, EKS tags)
- [x] Create EKS module (cluster, general + voip node groups, OIDC, IAM roles, taints)
- [x] Create RDS PostgreSQL module (multi-AZ, subnet group, parameter group, auto-scaling storage)
- [x] Create ElastiCache Redis module (subnet group, parameter group)
- [x] Create S3 module (recordings + voicemail buckets, lifecycle IA/Glacier/expiry, AES256 encryption)
- [x] Create ECR module (freeswitch, kamailio, flexisip, backend repos with lifecycle)
- [x] Create NLB module (SIP UDP/TCP, SIP TLS, WSS listeners + target groups)
- [x] Create security groups module (EKS, SIP, RTP 20000-30000, API, DB, Redis rules)
- [x] Create k8s-services.tf (namespace, configmap, secret, deployments, services, ingress, HPAs, PVC, db-init job)
- [x] Create outputs.tf (VPC, EKS, RDS, Redis, S3, ECR, NLB, DNS records needed)
- [x] Create terraform.tfvars.example with commented defaults and cost optimization notes
- [x] Create deploy.sh automation script (pre-flight, init, plan, apply, Docker build+push, kubectl verify, summary)
- [x] Create MANUS_DEPLOY_INSTRUCTIONS.md (9-step guide, prerequisites, troubleshooting, teardown, cost optimization)

## Phase 21 — Prometheus + Grafana Monitoring Stack
- [x] Create Terraform monitoring module (infra/terraform/modules/monitoring/main.tf)
- [x] Deploy Prometheus via Helm (kube-prometheus-stack) with VoIP scrape configs
- [x] Deploy Grafana via Helm with persistent storage and admin credentials
- [x] Create Prometheus scrape configs for FreeSWITCH, Kamailio, Flexisip, Backend
- [x] Create alerting rules (voip-alerts.yaml — 10 rules: call failure, trunk down, MOS, jitter, registrations, push delivery, pod restarts, CPU, memory, disk)
- [x] Create Grafana dashboard: SIP Overview (12 panels — registrations, concurrent calls, CPS, error rate, response codes, trunk health, latency)
- [x] Create Grafana dashboard: Call Quality (12 panels — MOS gauge, jitter, packet loss, RTT, RTP streams, codec distribution, quality buckets)
- [x] Create Grafana dashboard: Infrastructure (14 panels — pod status, CPU/memory by pod, network I/O, PVC usage, PostgreSQL queries, Redis stats)
- [x] Create Grafana dashboard: Push Notifications (9 panels — delivery rate, FCM/APNs split, latency percentiles, failure reasons, token counts)
- [x] Wire monitoring module into main.tf (depends on EKS module)
- [x] Add ServiceMonitor CRDs for each service (in monitoring module)

## Phase 22 — GitHub Actions CI/CD Pipeline
- [x] Create Docker build workflow (.github/workflows/docker-build.yml) — path-filtered per-service builds, ECR push, GHA cache
- [x] Create EKS deploy workflow (.github/workflows/deploy-eks.yml) — staging/production, per-service deploy, health check, auto-rollback
- [x] Create test & lint workflow (.github/workflows/test.yml) — unit tests, TypeScript check, Terraform validate, Dockerfile lint
- [x] Terraform validate included in test.yml workflow
- [x] Docker build+push integrated per-service in docker-build.yml with GHA cache
- [x] Auto-rollback job in deploy-eks.yml — detects failed deployments and runs kubectl rollout undo
- [x] Workflow documentation embedded in workflow file comments and deploy summary

## Phase 23 — Call Queue Management
- [ ] Create queue types (lib/queue/types.ts) — queue, agent, tier, member, stats, wallboard data
- [ ] Create queue engine (lib/queue/engine.ts) — FreeSWITCH mod_callcenter integration, agent state machine, mock data
- [ ] Create queue store (lib/queue/store.ts) — Zustand with agent state, queue stats, wallboard polling
- [ ] Build agent dashboard screen (app/queue/agent.tsx) — login/logout, status toggle (Available/Break/Wrap-up), assigned queues, personal stats
- [ ] Build real-time wallboard screen (app/queue/wallboard.tsx) — queue cards with live stats, agent grid with status colors, SLA gauge, waiting callers
- [ ] Build queue configuration screen (app/queue/config.tsx) — create/edit queues, assign agents/tiers, set strategy/timeouts/MOH
- [ ] Wire queue entry points from Settings and Admin screens
- [ ] Add queue-related icons to icon-symbol.tsx if needed
- [ ] Write unit tests for queue types and engine
