# CloudPhone11 — Deployment Guide

## Architecture Overview

CloudPhone11 runs on a fully open-source VoIP stack:

| Service | Image | Role | License |
|---------|-------|------|---------|
| **Kamailio** | `cloudphone11/kamailio` | SIP proxy, registrar, load balancer, WSS | GPLv2 |
| **FreeSWITCH** | `cloudphone11/freeswitch` | Media server, PBX, recording, conferencing | MPL 1.1 |
| **Flexisip** | `cloudphone11/flexisip` | Push gateway (FCM/APNs) for mobile wake | AGPLv3 |
| **Backend API** | `cloudphone11/backend` | REST/tRPC API, auth, AI analysis | Custom |
| **PostgreSQL** | `postgres:16-alpine` | Primary database | PostgreSQL |
| **Redis** | `redis:7-alpine` | Cache, presence, Flexisip registrations | BSD |
| **RTPEngine** | `drachtio/rtpengine` | Media relay for NAT traversal | GPLv2 |

### Call Flow

```
Mobile App ──WSS──▶ Kamailio ──SIP──▶ FreeSWITCH ──RTP──▶ Media
                       │                    │
                       │ (offline user)      │ (recording)
                       ▼                    ▼
                   Flexisip             Recordings PVC
                       │
                       ▼
                  FCM / APNs ──push──▶ Mobile Device Wakes
```

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- Kubernetes 1.28+ (for K8s deployment)
- TLS certificates for your SIP domain
- FCM server key and APNs certificate (for push notifications)
- A public IP address for SIP/RTP traffic

---

## Quick Start (Docker Compose — Development)

```bash
cd infra/compose

# 1. Create environment file
cp env-template.txt .env
# Edit .env with your values

# 2. Place TLS certificates
mkdir -p tls apns
cp /path/to/fullchain.pem tls/
cp /path/to/privkey.pem tls/
cp /path/to/apns-cert.pem apns/

# 3. Start all services
docker compose -f docker-compose.dev.yml up -d

# 4. Verify services
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml logs -f
```

### Service Ports (Development)

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| Kamailio | 5070 | UDP/TCP | SIP signaling |
| Kamailio | 5071 | TCP | SIP-TLS |
| Kamailio | 7443 | TCP | WebSocket Secure (WSS) |
| FreeSWITCH | 5060 | UDP/TCP | Internal SIP |
| FreeSWITCH | 8021 | TCP | Event Socket (ESL) |
| Flexisip | 5065 | UDP/TCP | Push gateway SIP |
| Flexisip | 8888 | TCP | Admin API |
| Backend | 3000 | TCP | REST/tRPC API |
| PostgreSQL | 5432 | TCP | Database |
| Redis | 6379 | TCP | Cache |

---

## Production (Docker Compose)

```bash
cd infra/compose

# 1. Create and secure environment file
cp env-template.txt .env
chmod 600 .env
# Edit .env with production values

# 2. Place production TLS certificates
mkdir -p tls apns
# ... copy certs

# 3. Start with production compose
docker compose -f docker-compose.prod.yml up -d

# 4. Monitor
docker compose -f docker-compose.prod.yml logs -f --tail=100
```

### Resource Requirements (Production)

| Service | CPU (request/limit) | Memory (request/limit) | Storage |
|---------|---------------------|------------------------|---------|
| PostgreSQL | 0.5 / 2 cores | 512Mi / 2Gi | 50Gi SSD |
| Redis | 0.25 / 1 core | 256Mi / 768Mi | 10Gi SSD |
| FreeSWITCH | 1 / 4 cores | 1Gi / 4Gi | 200Gi (recordings) |
| Kamailio | 0.5 / 2 cores | 512Mi / 2Gi | — |
| Flexisip | 0.25 / 1 core | 256Mi / 1Gi | — |
| Backend | 0.5 / 2 cores | 512Mi / 2Gi | — |
| RTPEngine | host network | 1Gi | — |

**Minimum total:** 4 CPU cores, 8GB RAM, 310Gi storage

---

## Kubernetes Deployment

### 1. Apply Base Manifests

```bash
# Create namespace and RBAC
kubectl apply -f infra/k8s/base/namespace.yaml

# Create secrets (edit values first!)
kubectl apply -f infra/k8s/base/configmaps.yaml

# Create persistent storage
kubectl apply -f infra/k8s/base/storage.yaml

# Deploy all services
kubectl apply -f infra/k8s/base/deployments.yaml

# Create services and load balancer
kubectl apply -f infra/k8s/base/services.yaml

# Create ingress and autoscaling
kubectl apply -f infra/k8s/base/ingress.yaml
```

### 2. Verify Deployment

```bash
# Check all pods
kubectl get pods -n cloudphone11

# Check services
kubectl get svc -n cloudphone11

# Check Kamailio NLB external IP
kubectl get svc kamailio -n cloudphone11 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

# Check logs
kubectl logs -n cloudphone11 -l app.kubernetes.io/name=kamailio --tail=50
kubectl logs -n cloudphone11 -l app.kubernetes.io/name=freeswitch --tail=50
```

### 3. DNS Configuration

Point these DNS records to your cluster:

| Record | Type | Target |
|--------|------|--------|
| `sip.cloudphone11.io` | A/CNAME | Kamailio NLB IP |
| `api.cloudphone11.io` | A/CNAME | Ingress controller IP |
| `wss.cloudphone11.io` | A/CNAME | Ingress controller IP |
| `_sip._udp.cloudphone11.io` | SRV | `0 5 5060 sip.cloudphone11.io` |
| `_sip._tcp.cloudphone11.io` | SRV | `0 5 5060 sip.cloudphone11.io` |
| `_sips._tcp.cloudphone11.io` | SRV | `0 5 5061 sip.cloudphone11.io` |

### 4. Scaling

```bash
# Scale Kamailio (SIP proxy)
kubectl scale deployment kamailio -n cloudphone11 --replicas=4

# Scale Backend API
kubectl scale deployment backend -n cloudphone11 --replicas=5

# HPA handles auto-scaling based on CPU/memory
kubectl get hpa -n cloudphone11
```

---

## Configuration Reference

### FreeSWITCH

Configuration files are in `infra/configs/freeswitch/`:

| File | Purpose |
|------|---------|
| `sip_profiles/internal.xml` | Internal SIP profile (extension-to-extension) |
| `sip_profiles/external.xml` | External SIP profile (PSTN trunks) |
| `dialplan/default.xml` | Call routing, recording, voicemail, conferencing |
| `autoload_configs/modules.conf.xml` | Loaded modules |

### Kamailio

Configuration in `infra/configs/kamailio/kamailio.cfg`:

- SIP registration and authentication via PostgreSQL
- Load balancing to FreeSWITCH via dispatcher module
- NAT traversal with RTPEngine
- WebSocket (WSS) for WebRTC/mobile clients
- Presence/BLF for contact status
- Anti-flood protection with pike module
- Voicemail fallback on busy/no-answer

### Flexisip

Configuration in `infra/configs/flexisip/flexisip.conf`:

- FCM (Android) push via Firebase HTTP v1 API
- APNs (iOS) push with VoIP push for instant wake
- Redis-backed registration storage for HA
- DoS protection with rate limiting

---

## Monitoring

### Health Checks

```bash
# FreeSWITCH
docker exec cp11-freeswitch fs_cli -x "status"
docker exec cp11-freeswitch fs_cli -x "show channels"

# Kamailio
docker exec cp11-kamailio kamcmd core.psx
docker exec cp11-kamailio kamcmd ul.dump

# Flexisip
curl http://localhost:8888/api/stats

# Backend
curl http://localhost:3000/health
```

### Key Metrics to Monitor

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Active SIP registrations | Kamailio `ul.dump` | < 50% of expected |
| Concurrent calls | FreeSWITCH `show channels` | > 80% capacity |
| Call setup time | CDR table | > 3 seconds |
| Push delivery rate | Flexisip stats | < 95% |
| Database connections | PostgreSQL `pg_stat_activity` | > 80% max |
| Memory usage | All containers | > 85% limit |

---

## Backup and Recovery

### Database Backup

```bash
# Manual backup
docker exec cp11-postgres pg_dump -U cloudphone11 cloudphone11 > backup_$(date +%Y%m%d).sql

# Automated daily backup (add to crontab)
0 2 * * * docker exec cp11-postgres pg_dump -U cloudphone11 cloudphone11 | gzip > /backup/cp11_$(date +\%Y\%m\%d).sql.gz
```

### Recording Backup

```bash
# Sync recordings to S3
aws s3 sync /var/lib/freeswitch/recordings s3://cloudphone11-recordings/ --storage-class STANDARD_IA
```

---

## Troubleshooting

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Calls not connecting | Check Kamailio logs for 404/408 | Verify user registration: `kamcmd ul.dump` |
| One-way audio | NAT traversal issue | Ensure RTPEngine is running and `EXTERNAL_IP` is correct |
| Push not waking device | Flexisip cert issue | Verify APNs cert: `openssl x509 -in apns-cert.pem -noout -dates` |
| Registration failures | Auth issue | Check subscriber table in PostgreSQL |
| High latency | Network or overload | Check CPU/memory, scale Kamailio replicas |
| Recording missing | Disk full or permissions | Check `recordings-pvc` usage and FreeSWITCH logs |

---

## Security Checklist

- [ ] TLS certificates installed for all SIP endpoints
- [ ] Strong passwords in `.env` / Kubernetes secrets
- [ ] Kamailio pike module enabled (anti-flood)
- [ ] PostgreSQL listening only on internal network
- [ ] Redis password set and not exposed externally
- [ ] FreeSWITCH ESL only on localhost/internal
- [ ] APNs certificate and FCM key stored securely
- [ ] Regular database backups configured
- [ ] Log rotation configured for all services
- [ ] Network policies restricting inter-pod traffic (K8s)
