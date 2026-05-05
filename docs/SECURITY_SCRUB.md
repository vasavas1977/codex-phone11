# Security Scrub Report

## Date: 2026-05-05

## Files REMOVED from Archive (sensitive material)

| File Path | Type | Replacement |
|-----------|------|-------------|
| `.env` | Environment variables | `.env.example` provided |
| `infra/terraform/terraform.tfstate` | Terraform state (contains resource IDs, ARNs) | None — regenerate with `tofu apply` |
| `infra/terraform/terraform.tfstate.backup` | Terraform state backup | None |
| `infra/terraform/terraform.tfvars` | Terraform variables (DB credentials, cert ARNs) | `terraform.tfvars.example` provided |
| `infra/terraform/tfplan` | Binary plan file | None — regenerate with `tofu plan` |
| `infra/configs/kamailio/tls/ca.crt` | TLS CA certificate | Regenerate per deploy guide |
| `infra/configs/kamailio/tls/server.crt` | TLS server certificate | Regenerate per deploy guide |
| `infra/configs/kamailio/tls/*.key` | TLS private keys (if any) | Regenerate per deploy guide |

## Files SANITIZED (hardcoded credentials replaced with placeholders)

| File Path | Lines | Type | Placeholder Used |
|-----------|-------|------|------------------|
| `infra/configs/freeswitch/vars.xml` | 15 | SIP default password | `CHANGE_ME_DEFAULT_PASSWORD` |
| `infra/configs/freeswitch/autoload_configs/event_socket.conf.xml` | 6 | ESL password | `CHANGE_ME_ESL_PASSWORD` |
| `infra/configs/freeswitch/autoload_configs/hiredis.conf.xml` | 7, 13 | Redis password | `CHANGE_ME_REDIS_PASSWORD` |
| `deploy/billrun/billrun.conf` | 28 | DB password | `CHANGE_ME_DB_PASSWORD` |
| `deploy/billrun/billrun.conf` | 35 | API key | `CHANGE_ME_API_KEY` |
| `deploy/billrun/billrun.conf` | 114 | ESL password | `CHANGE_ME_ESL_PASSWORD` |

## Files SAFE (already use env vars or template placeholders)

| File Path | Notes |
|-----------|-------|
| `infra/configs/kamailio/kamailio.cfg` | Uses `KAM_SECRET` substdef — value set at deploy time |
| `infra/configs/flexisip/flexisip.conf` | Uses `__REDIS_PASSWORD__`, `__FCM_API_KEY__` placeholders |
| `server/pbx/sip-secrets.ts` | Reads `process.env.SIP_DEK_SECRET` at runtime |
| `infra/configs/freeswitch/directory/default/*.xml` | Reference `$${default_password}` variable |

## Directories EXCLUDED from Archive

| Directory/Pattern | Reason |
|-------------------|--------|
| `node_modules/` | Dependencies — install via `pnpm install` |
| `.git/` | Git history from server |
| `.terraform/providers/` | Large provider binaries — `tofu init` downloads them |
| `dist/` | Build artifacts |
| `.expo/` | Expo cache |
| `recordings/` | Call recordings (customer data) |
| `*.log` | Log files with potential PII |
| `*.pem` | SSH/TLS private keys |

## How to Restore Secrets for Deployment

1. Copy `.env.example` → `.env` and fill in real values
2. Copy `infra/terraform/terraform.tfvars.example` → `terraform.tfvars` and fill in real values
3. Generate TLS certs per `infra/configs/kamailio/tls/README.md`
4. Replace `CHANGE_ME_*` placeholders in FreeSWITCH/BillRun configs
5. Run `tofu init && tofu plan` to regenerate state
