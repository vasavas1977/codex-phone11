# CloudPhone11 — Deployment Guide

This guide walks you through deploying the complete CloudPhone11 backend infrastructure: **BillRun BSS**, **Kamailio SIP Proxy**, and **FreeSWITCH PBX**.

---

## Prerequisites

Before you begin, ensure you have:

| Requirement | Minimum |
|---|---|
| **Server OS** | Ubuntu 22.04 LTS or Debian 12 |
| **RAM** | 8 GB minimum (16 GB recommended) |
| **CPU** | 4 cores minimum |
| **Storage** | 100 GB SSD |
| **Docker** | Docker Engine 24+ and Docker Compose v2 |
| **Network** | Public IP with ports 5060-5061, 8080, 8443, 16384-16484 open |
| **Domain** | A domain name (e.g., sip.yourcompany.com) with DNS A record pointing to your server |
| **TLS Certificate** | Let's Encrypt or commercial certificate for your SIP domain |

---

## Step 1 — Deploy BillRun BSS

BillRun handles all billing, rating, invoicing, and subscriber management.

```bash
cd deploy/billrun

# 1. Copy the environment template
cp env-template.txt .env

# 2. Edit .env with your values
nano .env
# Set: BILLRUN_DOMAIN, BILLRUN_SECRET_KEY, MONGO_PASSWORD

# 3. Start BillRun
docker-compose up -d

# 4. Wait for initialization (2-3 minutes)
docker-compose logs -f billrun

# 5. Access BillRun admin panel
# Open: http://YOUR_SERVER:8080/admin
# Default credentials: admin / admin (change immediately)
```

After BillRun is running, retrieve your API key:

```bash
# Generate API key from BillRun admin panel:
# Settings → API Access → Generate New Key
# Copy the key — you will need it for CloudPhone11
```

---

## Step 2 — Deploy Kamailio SIP Proxy

Kamailio handles SIP registration, call routing, NAT traversal, and security.

```bash
cd deploy/kamailio

# 1. Edit kamailio.cfg — replace placeholders:
#    MY_IP_ADDR     → your server's public IP
#    MY_DOMAIN      → your SIP domain (e.g., sip.yourcompany.com)
#    FREESWITCH_IP  → FreeSWITCH server IP (127.0.0.1 if same server)
#    DINSTAR_IP     → your Dinstar SBC IP address
nano kamailio.cfg

# 2. Set up TLS certificates
mkdir -p /etc/kamailio/tls
# Option A: Let's Encrypt (free)
certbot certonly --standalone -d sip.yourcompany.com
cp /etc/letsencrypt/live/sip.yourcompany.com/fullchain.pem /etc/kamailio/tls/server.crt
cp /etc/letsencrypt/live/sip.yourcompany.com/privkey.pem /etc/kamailio/tls/server.key

# 3. Start Kamailio
docker-compose up -d

# 4. Verify SIP is listening
docker exec cloudphone11-kamailio kamctl stats

# 5. Add a test subscriber
docker exec -it cloudphone11-kamailio kamctl add testuser@sip.yourcompany.com testpassword123
```

---

## Step 3 — Deploy FreeSWITCH PBX

FreeSWITCH handles IVR, voicemail, conferencing, call recording, and CDR generation.

```bash
cd deploy/freeswitch

# 1. Edit the dial plan — replace KAMAILIO_IP:
nano dialplan/cloudphone11.xml
# Replace KAMAILIO_IP with your Kamailio server IP

# 2. Edit CDR config — replace BILLRUN_HOST:
nano conf/cdr_billrun.xml
# Replace BILLRUN_HOST with your BillRun server IP

# 3. Edit DID routing script:
nano scripts/did_routing.lua
# Update the did_routes table with your real DID numbers

# 4. Start FreeSWITCH
docker-compose up -d

# 5. Verify FreeSWITCH is running
docker exec cloudphone11-freeswitch fs_cli -x "status"
```

---

## Step 4 — Configure CloudPhone11 App

Open the CloudPhone11 app and navigate to **Settings → Server Configuration**:

| Field | Value |
|---|---|
| **SIP Domain** | `sip.yourcompany.com` |
| **SIP Port** | `5060` (UDP) or `5061` (TLS) |
| **Transport** | TLS recommended for production |
| **Dinstar IP** | Your Dinstar SBC IP address |
| **BillRun URL** | `https://billing.yourcompany.com` |
| **BillRun API Key** | The key generated in Step 1 |
| **FreeSWITCH Host** | Your FreeSWITCH server IP |
| **ESL Port** | `8021` |
| **DID Provider** | DIDww, DIDx, or Custom |
| **DID API Key** | Your DID provider API key |

Tap **Save**, then tap each **Test** button to verify connectivity.

---

## Step 5 — Connect to Your Existing Dinstar SBC

Your Dinstar SBC is already deployed. Configure it to route traffic to Kamailio:

```
# In Dinstar SBC admin panel:
# SIP Trunk → Add New Trunk
#   Name: CloudPhone11-Kamailio
#   Type: SIP Peer
#   Remote IP: YOUR_KAMAILIO_IP
#   Remote Port: 5060
#   Transport: UDP or TCP
#   Codec: G.711a, G.711u, G.722, Opus

# Routing Rules → Add Rule
#   Source: PSTN (from AudioCodes/Zoom Provider Exchange)
#   Destination: CloudPhone11-Kamailio trunk
```

---

## Step 6 — Connect AudioCodes to Zoom Provider Exchange

Your AudioCodes is already connected to Zoom Provider Exchange. Ensure inbound Zoom PSTN calls route through Dinstar to Kamailio:

```
AudioCodes → Dinstar SBC → Kamailio → FreeSWITCH (DID routing)
                                    → CloudPhone11 App (user extension)
```

---

## Verification Checklist

After deployment, verify each component:

| Test | Command / Action | Expected Result |
|---|---|---|
| BillRun API | `curl http://YOUR_SERVER:8080/billapi/health` | `{"status": "ok"}` |
| Kamailio SIP | `kamctl stats` | Active registrations shown |
| FreeSWITCH | `fs_cli -x "status"` | Sessions and channels shown |
| SIP Registration | Register CloudPhone11 app | Status shows "Registered" |
| Internal Call | Call extension 9196 (echo test) | Hear your voice echoed back |
| IVR | Call extension 0 | Hear auto-attendant greeting |
| PSTN Outbound | Dial external number | Call connects via Dinstar |
| PSTN Inbound | Call your DID number | CloudPhone11 rings |
| BillRun CDR | Make a call, check BillRun | CDR appears in billing |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| SIP registration fails | Check Kamailio logs: `docker logs cloudphone11-kamailio` |
| No audio on calls | Check RTPEngine: `docker logs cloudphone11-rtpengine` |
| CDRs not appearing in BillRun | Check FreeSWITCH CDR logs: `/var/log/freeswitch/cdr-json/errors/` |
| DID calls not routing | Check `did_routing.lua` — ensure DID numbers match |
| TLS handshake fails | Verify certificate paths in `tls.cfg` |

---

## Security Hardening (Production)

Before going live, apply these security measures:

1. **Change all default passwords** — Kamailio MySQL, FreeSWITCH ESL, BillRun admin
2. **Enable TLS everywhere** — SIP TLS (5061), SRTP for media, HTTPS for BillRun
3. **Firewall rules** — Only allow SIP from known IP ranges
4. **Fail2ban** — Install and configure for SIP brute-force protection
5. **Rate limiting** — Kamailio pike module is pre-configured (30 req/sec per IP)
6. **Backup** — Schedule daily backups of BillRun MongoDB and Kamailio MySQL
