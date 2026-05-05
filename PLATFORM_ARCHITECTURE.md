# CloudPhone11 — Converged Telecom Platform Architecture
### Powered by BillRun Open Source BSS

**Version:** 1.0  
**Date:** April 2026  
**Classification:** Confidential — Investor & Technical Reference

---

## Executive Summary

CloudPhone11 is a converged telecom operator platform built on a 100% open-source stack, designed to compete directly with Zoom Phone, 8x8, and Vonage in the SMB and enterprise markets. The platform integrates **BillRun** as its converged billing and BSS engine, enabling unified billing across four revenue streams: **VoIP Voice, MVNO SIM, SMS, and DID numbers** — all from a single platform with zero licensing cost.

The architecture is purpose-built for a telecom operator targeting institutional investors and a future IPO. Every component is either open-source or owned outright by the operator, ensuring **100% IP ownership**, **maximum gross margins**, and **zero vendor lock-in** — the three pillars that underwriters and investors scrutinize most closely.

---

## 1. Platform Overview

### 1.1 Revenue Streams Supported

| Revenue Stream | Billing Model | BillRun Module |
|---|---|---|
| **VoIP Voice (SIP Trunk)** | Per-second CDR + monthly trunk fee | Monetization Platform (OCS) |
| **MVNO SIM** | Real-time Diameter Gy/Ro, bundles + overage | OCS + Prepaid/Postpaid |
| **SMS** | Per-message or bundle, SMPP mediation | Monetization Platform |
| **DID Numbers** | Monthly rental + inbound per-minute | Products + AutoRenew API |
| **Toll-Free Numbers** | Reverse charging (payback) | Conditional Charges |
| **Hosted PBX / IVR** | Per-seat monthly subscription | Plans + Services API |
| **Zoom Provider Exchange** | Carrier interconnect per-minute | CDR mediation |
| **CloudPhone11 App** | Monthly SaaS subscription | Plans API |

### 1.2 Key Business Metrics for Investors

| Metric | Detail |
|---|---|
| **BSS Licensing Cost** | $0 forever (BillRun AGPLv3) |
| **Switching Cost** | $0 (FreeSWITCH + Kamailio, open source) |
| **Mobile SDK Cost** | $0 (PJSIP, open source) |
| **IP Ownership** | 100% — all application code owned by operator |
| **Vendor Lock-in** | Zero — all components replaceable |
| **Reference Customer** | Golan Telecom (publicly traded, used BillRun) |
| **Scalability** | Horizontal scale-out, no per-subscriber licensing fees |

---

## 2. Full System Architecture

### 2.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        END USERS                                    │
│   CloudPhone11 iOS App    CloudPhone11 Android App    Web Browser   │
│         (PJSIP SDK)              (PJSIP SDK)          (WebRTC)      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ SIP/TLS + SRTP
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    KAMAILIO SIP PROXY                               │
│   • SIP registration & routing        • Load balancing             │
│   • NAT traversal (RTPEngine)         • TLS termination            │
│   • BillRun auth integration          • Fraud detection            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ SIP
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   DINSTAR SBC (Existing)                            │
│   • Session border control            • Transcoding                │
│   • SIP normalization                 • Security / DoS protection  │
└──────────┬────────────────────────────────────────┬────────────────┘
           │ SIP (Internal)                          │ SIP (PSTN)
           ▼                                         ▼
┌──────────────────────┐              ┌──────────────────────────────┐
│   FREESWITCH PBX     │              │  AUDIOCODES SBC (Existing)   │
│   • IVR engine       │              │  • Zoom Provider Exchange    │
│   • Voicemail        │              │  • PSTN interconnect         │
│   • Conferencing     │              │  • E.164 number routing      │
│   • Call recording   │              └──────────────────────────────┘
│   • Auto-attendant   │
└──────────┬───────────┘
           │ CDR (CSV/RADIUS/HTTP)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BILLRUN BSS PLATFORM                             │
│                  (Open Source — AGPLv3 — $0)                       │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │  Monetization   │  │   CRM Module    │  │ Customer Portal │    │
│  │  Platform (OCS) │  │  (Open Source)  │  │  (Self-Service) │    │
│  │  • Prepaid      │  │  • Accounts     │  │  • DID mgmt     │    │
│  │  • Postpaid     │  │  • Subscribers  │  │  • Invoices     │    │
│  │  • Real-time    │  │  • Tickets      │  │  • Usage stats  │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │  Number Port.   │  │  Call Generator │  │  Invoicing &    │    │
│  │  Gateway (NPG)  │  │  (Rev. Assur.)  │  │  Payments       │    │
│  │  • DID porting  │  │  • CDR testing  │  │  • Auto-invoice │    │
│  │  • MNP support  │  │  • Leak detect  │  │  • Multi-curr.  │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
           │ Diameter Gy/Ro
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MVNO CORE (MNO Integration)                      │
│   • HLR/HSS provisioning              • SMSC (SMS routing)         │
│   • SIM lifecycle management          • CAMEL/IN charging          │
│   • Roaming settlement                • 4G/5G data charging        │
└─────────────────────────────────────────────────────────────────────┘
           │ API
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DID PROVISIONING LAYER                           │
│   • DIDww / DIDx API integration      • Number inventory DB        │
│   • On-demand number acquisition      • Markup pricing engine      │
│   • Real-time activation              • International DID catalog  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. BillRun Integration Details

### 3.1 BillRun REST API — Key Endpoints Used

BillRun exposes a full REST API at `http://HOST/billapi/<entity>/<method>`. The following endpoints are critical for CloudPhone11 integration:

| Entity | Endpoint | Purpose |
|---|---|---|
| **Accounts** | `POST /billapi/accounts/create` | Create customer account when user registers |
| **Subscribers** | `POST /billapi/subscribers/create` | Create SIM/SIP subscriber under account |
| **Plans** | `GET /billapi/plans/get` | Fetch available plans for in-app plan selection |
| **Balances** | `GET /billapi/balances/get` | Real-time balance check before call authorization |
| **Balances** | `POST /billapi/balances/update` | Top-up prepaid balance |
| **AutoRenew** | `POST /billapi/autorenew/create` | Set up monthly DID rental recurring charge |
| **Lines** | `GET /billapi/lines/get` | Retrieve CDR records for call history display |
| **Events** | `GET /billapi/events/get` | Real-time usage events for dashboard |
| **Invoices** | `GET /billapi/invoices/get` | Retrieve invoices for customer portal |
| **Services** | `POST /billapi/services/create` | Activate DID number as a billable service |

### 3.2 CDR Mediation Flow

FreeSWITCH generates CDR records for every call. These are fed into BillRun's mediation engine for real-time rating and billing:

```
FreeSWITCH Call Ends
      ↓
CDR Generated (JSON/CSV)
      ↓
BillRun Mediation Engine
      ↓
Rate Lookup (plan rates table)
      ↓
Real-Time Balance Deduction (prepaid) OR Invoice Accumulation (postpaid)
      ↓
CDR stored in MongoDB
      ↓
Available via /billapi/lines/get for CloudPhone11 app
```

### 3.3 Real-Time Call Authorization (Kamailio ↔ BillRun)

For prepaid subscribers, every call must be authorized against the BillRun balance before connecting:

```
Kamailio receives INVITE
      ↓
HTTP request to BillRun /billapi/balances/get
      ↓
Balance > 0 ? → Allow call → FreeSWITCH
Balance = 0 ? → Reject with 402 Payment Required
      ↓
On call end: CDR → BillRun → deduct balance
```

### 3.4 DID Billing Flow

```
User selects DID in CloudPhone11 app
      ↓
CloudPhone11 API calls DIDww/DIDx API → acquire number
      ↓
Number activated on FreeSWITCH dialplan
      ↓
BillRun /billapi/services/create → create DID service
      ↓
BillRun /billapi/autorenew/create → monthly rental charge
      ↓
Inbound calls to DID → CDR → BillRun rates per-minute inbound
      ↓
Monthly invoice includes: DID rental + inbound minutes
```

---

## 4. Component Integration Map

### 4.1 Existing Infrastructure (Keep As-Is)

| Component | Role | Integration Point |
|---|---|---|
| **Dinstar SBC** | Session border control, SIP normalization | Sits between Kamailio and FreeSWITCH/PSTN |
| **AudioCodes + Zoom Provider Exchange** | PSTN interconnect, Zoom carrier revenue | Connected to Dinstar SBC for PSTN routing |

### 4.2 New Components to Deploy

| Component | Role | Technology |
|---|---|---|
| **Kamailio** | SIP proxy, registration, load balancing | Open source, AGPLv2 |
| **FreeSWITCH** | PBX, IVR, voicemail, conferencing | Open source, MPL |
| **RTPEngine** | Media relay, transcoding, SRTP | Open source, GPLv2 |
| **BillRun** | Converged BSS — billing, CRM, portal | Open source, AGPLv3 |
| **MongoDB** | BillRun database | Open source |
| **Elasticsearch** | BillRun CDR indexing and reporting | Open source |
| **DID Provisioning Service** | Custom API bridge to DIDww/DIDx | Node.js microservice |
| **Flexisip Push Gateway** | Reliable push for incoming calls | Open source, AGPLv3 |

### 4.3 Mobile App Stack

| Layer | Technology | License |
|---|---|---|
| **React Native** | Cross-platform iOS + Android | MIT |
| **PJSIP (PJSUA2)** | SIP/VoIP engine | GPL v2 + commercial exception |
| **Expo SDK 54** | Native device APIs | MIT |
| **CallKit (iOS)** | Native incoming call UI | Apple (free) |
| **ConnectionService (Android)** | Native incoming call UI | Google (free) |

---

## 5. MVNO SIM Integration

### 5.1 Diameter Interface

BillRun supports real-time charging via the **Diameter Gy** (online charging) and **Ro** (credit control) interfaces, which are the standard interfaces used by 4G/5G mobile networks:

```
Mobile Device (SIM)
      ↓ (voice call / SMS / data)
MNO Core Network (PCRF/PCEF)
      ↓ Diameter Gy/Ro
BillRun OCS (Online Charging System)
      ↓ Credit Authorization
Real-time balance check + deduction
      ↓
CDR → Invoice → Customer Portal
```

### 5.2 SIM Lifecycle Management

| Event | BillRun API Action |
|---|---|
| New SIM activation | `POST /billapi/subscribers/create` with IMSI/MSISDN |
| Plan change | `POST /billapi/subscribers/permanentchange` |
| SIM suspension | `POST /billapi/subscribers/close` |
| SIM reactivation | `POST /billapi/subscribers/reopen` |
| Balance top-up | `POST /billapi/balances/update` |

---

## 6. DID Number Management

### 6.1 DID Provisioning Architecture

CloudPhone11 integrates with wholesale DID providers (**DIDww** and **DIDx**) via their REST APIs. A lightweight Node.js microservice acts as the bridge between the CloudPhone11 app, BillRun, and the DID providers:

```
CloudPhone11 App
      ↓ REST API
DID Provisioning Microservice (Node.js)
      ├── DIDww API → search/acquire/release numbers
      ├── BillRun API → create service + autorenew billing
      └── FreeSWITCH ESL → activate number in dialplan
```

### 6.2 DID Number Types Supported

| Type | Billing Model | Typical Retail Price |
|---|---|---|
| **Local DID** (geographic) | Monthly rental + inbound minutes | $2–$5/month |
| **National DID** (non-geographic) | Monthly rental + inbound minutes | $3–$8/month |
| **Toll-Free** | Monthly rental + reverse per-minute | $10–$25/month |
| **Premium Rate** | Revenue share payback | Varies |
| **International DID** | Monthly rental + inbound minutes | $5–$20/month |

---

## 7. Investor-Grade Architecture Principles

### 7.1 Gross Margin Structure

The open-source stack creates a structurally superior gross margin compared to licensed competitors:

| Cost Category | CloudPhone11 | Zoom Phone | 8x8 |
|---|---|---|---|
| BSS/Billing licensing | **$0** | Proprietary | Proprietary |
| Softswitch licensing | **$0** | Proprietary | Proprietary |
| Mobile SDK licensing | **$0** | Proprietary | Proprietary |
| PSTN termination | Direct SIP trunk | Reseller markup | Reseller markup |
| Infrastructure | Cloud (scales with revenue) | Cloud | Cloud |

### 7.2 Scalability

BillRun is architected for horizontal scale-out using MongoDB and Elasticsearch. The platform has been validated at:

- **Golan Telecom:** Millions of subscribers on a publicly traded operator
- **No per-subscriber licensing fees:** Gross margin improves as subscriber count grows

### 7.3 IP Ownership Summary

| Component | Owner | License |
|---|---|---|
| CloudPhone11 mobile app | **Operator (100%)** | Proprietary |
| BillRun customizations | **Operator (100%)** | AGPLv3 |
| FreeSWITCH dialplan configs | **Operator (100%)** | MPL |
| Kamailio routing configs | **Operator (100%)** | AGPLv2 |
| DID provisioning microservice | **Operator (100%)** | Proprietary |
| Admin web portal | **Operator (100%)** | Proprietary |

---

## 8. Deployment Architecture

### 8.1 Recommended Cloud Infrastructure

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUD INFRASTRUCTURE                         │
│                  (AWS / GCP / Azure / On-Prem)                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  SIP Cluster │  │  App Cluster │  │   BSS Cluster        │  │
│  │  Kamailio x2 │  │  FreeSWITCH  │  │   BillRun            │  │
│  │  RTPEngine   │  │  x4 (HA)     │  │   MongoDB (replica)  │  │
│  └──────────────┘  └──────────────┘  │   Elasticsearch      │  │
│                                       └──────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              EXISTING HARDWARE (On-Prem)                 │   │
│  │   Dinstar SBC          AudioCodes + Zoom Exchange        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 High Availability

| Component | HA Strategy |
|---|---|
| Kamailio | Active-active pair with DNS failover |
| FreeSWITCH | Multiple nodes behind Kamailio dispatcher |
| BillRun | MongoDB replica set + Elasticsearch cluster |
| Dinstar SBC | Existing hardware HA configuration |

---

## 9. Implementation Roadmap

### Phase 1 — Core VoIP Platform (Month 1–2)
Deploy Kamailio + FreeSWITCH, integrate with existing Dinstar SBC and AudioCodes. CloudPhone11 app registers to Kamailio, makes and receives calls via PSTN through AudioCodes/Zoom Provider Exchange.

### Phase 2 — BillRun Billing Integration (Month 2–3)
Deploy BillRun, configure CDR mediation from FreeSWITCH, implement real-time call authorization via Kamailio ↔ BillRun API, set up prepaid/postpaid plans, customer portal.

### Phase 3 — DID Number Management (Month 3–4)
Build DID provisioning microservice, integrate DIDww/DIDx APIs, implement in-app DID number selection and management, configure BillRun autorenew for monthly DID billing.

### Phase 4 — MVNO SIM Integration (Month 4–6)
Integrate BillRun OCS with MNO Diameter interface, configure SIM lifecycle management, implement bundle billing for voice + SMS + data on SIM.

### Phase 5 — IPO Preparation (Month 6+)
Revenue assurance audit via BillRun Call Generator, financial reporting integration, SOC2 compliance preparation, investor data room preparation with BillRun CDR-based revenue history.

---

## 10. References

- **BillRun REST API Documentation:** https://docs.bill.run/en/api/5
- **BillRun MVNO Solution:** https://bill.run/solutions/billrun-mvno-solution
- **BillRun Digital Business Platform:** https://bill.run/products/digital-business-platform
- **PortaOne DID Management (comparison reference):** https://www.portaone.com/telecom-solutions/did-management/
- **Kamailio + FreeSWITCH Integration Guide:** https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Auxiliary-Knowledge-and-Utilities/Kamailio-basic-setup-as-proxy-for-FreeSWITCH_13174152/
- **Acrobits SDK Documentation:** https://doc.acrobits.net/sdk/
- **Linphone liblinphone SDK:** https://www.linphone.org/en/liblinphone-voip-sdk/
- **DIDww Wholesale DID API:** https://didlogic.com/products/exchange/wholesale-dids/
- **Golan Telecom (BillRun reference customer):** Publicly traded Israeli MVNO, acquired by Partner Communications

---

*Document prepared by Manus AI for CloudPhone11 operator platform architecture.*
