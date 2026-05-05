# Phone11.ai Deployment Report

**Date:** April 26, 2026  
**Region:** Asia Pacific (Thailand) — `ap-southeast-7`  
**AWS Account:** 1toall (326786006484)  
**Domain:** phone11.ai  
**Architecture:** EC2 + Docker (Option A)

---

## Architecture Overview

Phone11.ai is deployed using a hybrid EC2-based architecture optimized for VoIP workloads. This design prioritizes low-latency SIP/RTP processing with direct host networking, while keeping the backend API simple and maintainable. All infrastructure is managed via Terraform and deployed in the AWS Thailand region for optimal latency to Thai users.

```
                    ┌─────────────────────────────────────────────┐
                    │              AWS Thailand (ap-southeast-7)   │
                    │                                             │
  SIP Clients ─────┤──► VoIP Server (43.210.122.111)             │
  (UDP/TCP 5060)   │    ├── Kamailio 5.8 (SIP Proxy)            │
                    │    ├── FreeSWITCH 1.10 (Media)             │
                    │    └── RTPEngine (Media Relay)              │
                    │                                             │
  HTTP/API ────────┤──► Backend Server (43.209.112.208)          │
  Clients          │    ├── Nginx (Reverse Proxy + TLS)          │
                    │    └── Node.js Backend API                  │
                    │                                             │
                    │    ┌── RDS PostgreSQL (Multi-AZ) ──┐       │
                    │    ├── ElastiCache Redis            │       │
                    │    ├── S3 (Recordings)              │       │
                    │    └── S3 (Voicemail)               │       │
                    └─────────────────────────────────────────────┘
```

---

## Server Details

### VoIP Server

| Property | Value |
|---|---|
| Instance ID | `i-0851dd1ea1cfeef71` |
| Instance Type | `c5.xlarge` (4 vCPU, 8GB RAM) |
| Elastic IP | `43.210.122.111` |
| OS | Ubuntu 24.04 LTS |
| SSH Command | `ssh -i phone11ai-deploy.pem ubuntu@43.210.122.111` |

**Running Containers:**

| Container | Image | Status | Purpose |
|---|---|---|---|
| p11-freeswitch | safarov/freeswitch:1.10 | Healthy | SIP media server (port 5080) |
| p11-kamailio | kamailio/kamailio:5.8 | Running | SIP proxy/registrar (port 5060) |
| p11-rtpengine | drachtio/rtpengine | Running | RTP media relay (port 22222) |

### Backend Server

| Property | Value |
|---|---|
| Instance ID | `i-0cc8f248b08c5f2fb` |
| Instance Type | `t3.medium` (2 vCPU, 4GB RAM) |
| Elastic IP | `43.209.112.208` |
| OS | Ubuntu 24.04 LTS |
| SSH Command | `ssh -i phone11ai-deploy.pem ubuntu@43.209.112.208` |

**Running Services:**

| Service | Port | Status |
|---|---|---|
| Backend API (Node.js) | 3000 (internal) | Active (systemd managed) |
| Nginx (reverse proxy + TLS) | 80, 443 | Active |

---

## DNS Configuration (Completed)

All DNS records are configured in GoDaddy and fully propagated:

| Subdomain | Type | IP Address | Purpose |
|---|---|---|---|
| `phone11.ai` | A | 43.209.112.208 | Marketing website |
| `1toall.phone11.ai` | A | 43.209.112.208 | Backend management portal |
| `api.phone11.ai` | A | 43.209.112.208 | Backend API |
| `sip.phone11.ai` | A | 43.210.122.111 | SIP signaling |
| `wss.phone11.ai` | A | 43.210.122.111 | WebSocket SIP |
| `media.phone11.ai` | A | 43.210.122.111 | RTP media |

---

## TLS/SSL Certificates (Completed)

Both servers have valid Let's Encrypt certificates with automatic renewal configured via certbot.

| Server | Domains | Expiry | Auto-Renew |
|---|---|---|---|
| Backend | phone11.ai, 1toall.phone11.ai, api.phone11.ai | Jul 25, 2026 | Yes |
| VoIP | sip.phone11.ai, wss.phone11.ai, media.phone11.ai | Jul 25, 2026 | Yes |

HTTPS is active with HTTP-to-HTTPS redirect on the backend server. All three backend subdomains serve over TLS 1.2/1.3.

---

## Managed Services

### Database (RDS PostgreSQL)

| Property | Value |
|---|---|
| Engine | PostgreSQL 16.6 |
| Instance Class | db.t3.medium |
| Multi-AZ | Yes (automatic failover) |
| Endpoint | `phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com` |
| Port | 5432 |
| Database Name | `phone11ai` |
| Master User | `phone11ai_admin` |
| Password | `Kx7mP2nR9vL4qW8jT3` |

**Database Tables (10 total):** version, location, subscriber, dialog, dialog_vars, acc, missed_calls, silo, domain, users

### Cache (ElastiCache Redis)

| Property | Value |
|---|---|
| Engine | Redis 7.1 |
| Node Type | cache.t3.small |
| Endpoint | `phone11ai-production-redis.5rtuuk.0001.apse7.cache.amazonaws.com` |
| Port | 6379 |

### S3 Storage

| Bucket | Purpose |
|---|---|
| `phone11ai-production-recordings` | Call recordings (encrypted, public access blocked) |
| `phone11ai-production-voicemail` | Voicemail messages (encrypted, public access blocked) |

---

## Security

| Measure | Details |
|---|---|
| Security Groups | Strict port-based access control per server role |
| SSH Access | Key-based only (password auth disabled) |
| Fail2ban | Installed on both servers for SSH and SIP brute-force protection |
| TLS | All HTTP traffic redirected to HTTPS |
| RDS | Private subnet only, not publicly accessible |
| Redis | Private subnet only, not publicly accessible |
| S3 | Public access blocked, server-side encryption (AES256) |

---

## Cost Estimate

| Resource | Monthly Cost (est.) |
|---|---|
| EC2 c5.xlarge (VoIP) | ~$124 |
| EC2 t3.medium (Backend) | ~$30 |
| RDS db.t3.medium (Multi-AZ) | ~$70 |
| ElastiCache cache.t3.small | ~$25 |
| Elastic IPs (x2) | ~$7 |
| NAT Gateway | ~$32 |
| S3 + Data Transfer | ~$5-20 |
| **Total** | **~$293-308/mo** |

---

## SSH Access

```bash
# VoIP Server
ssh -i phone11ai-deploy.pem ubuntu@43.210.122.111

# Backend Server
ssh -i phone11ai-deploy.pem ubuntu@43.209.112.208
```

---

## Service Management

### Backend API (systemd)

```bash
sudo systemctl status phone11ai-backend    # Check status
sudo systemctl restart phone11ai-backend    # Restart
sudo journalctl -u phone11ai-backend -f     # View logs
```

### VoIP Containers (Docker Compose)

```bash
cd /opt/phone11ai/phone11ai/deploy/voip
docker compose ps                           # Check status
docker compose logs -f                      # View all logs
docker compose logs -f p11-kamailio         # Kamailio logs
docker compose restart                      # Restart all
```

---

## File Locations

| File | Server | Path |
|---|---|---|
| Docker Compose (VoIP) | VoIP | `/opt/phone11ai/phone11ai/deploy/voip/docker-compose.yml` |
| VoIP .env | VoIP | `/opt/phone11ai/phone11ai/deploy/voip/.env` |
| Kamailio config | VoIP | `/opt/phone11ai/phone11ai/deploy/voip/kamailio.cfg` |
| Backend .env | Backend | `/opt/phone11ai/phone11ai/deploy/backend/.env` |
| Backend systemd | Backend | `/etc/systemd/system/phone11ai-backend.service` |
| Nginx config | Backend | `/etc/nginx/sites-available/phone11ai` |
| TLS cert (Backend) | Backend | `/etc/letsencrypt/live/phone11.ai/` |
| TLS cert (VoIP) | VoIP | `/etc/letsencrypt/live/sip.phone11.ai/` |
| Terraform state | Sandbox | `/home/ubuntu/phone11ai/terraform/` |
| SSH key | Sandbox | `/home/ubuntu/phone11ai/terraform/phone11ai-deploy.pem` |
| Logo files | Sandbox | `/home/ubuntu/logos/` |

---

## Important: Clean Up Old Singapore Resources

The previous deployment attempt in `ap-southeast-1` (Singapore) created resources that may still be running and incurring charges. Go to the AWS Console for the Singapore region and delete the following:

- VPC and associated subnets, route tables, NAT gateways
- Partial EKS cluster
- RDS PostgreSQL instance
- ElastiCache Redis cluster
- S3 buckets (cloudphone11-production-recordings, cloudphone11-production-voicemail)
- ECR repositories
- ACM certificate for `*.ai.cloudphone11.com`

---

## Next Steps

1. **Marketing Website** — Build and deploy the marketing site for `phone11.ai` (currently returns "Cannot GET /")
2. **Backend Management Portal** — Build the admin UI for `1toall.phone11.ai`
3. **SIP TLS** — Configure Kamailio to use the Let's Encrypt certificate for SIP over TLS (port 5061)
4. **WebSocket SIP** — Configure FreeSWITCH/Kamailio WSS listener using the VoIP TLS certificate
5. **Push Notifications** — Configure FCM (Android) and APNs (iOS) when ready
6. **Monitoring** — Set up CloudWatch alarms for EC2, RDS, and Redis
7. **Backups** — Configure automated RDS snapshots and S3 lifecycle policies
8. **Clean up Singapore resources** to stop unnecessary charges
