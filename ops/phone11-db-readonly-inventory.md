# Phone11 DB Read-only Inventory

- Time UTC: 2026-05-17T04:02:13+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 81f7a2216b926dcfb157299fa367cca1faa3716a
- EC2 host: 43.209.112.208

## EC2
- Instance id: i-0cc8f248b08c5f2fb
- Availability zone: ap-southeast-7b

## Runtime backend env, sanitized
ENV_FILE=/opt/phone11ai/codex-phone11-deploy/.env
DB_HOST=phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com
DB_USER=<db-user>
DB_NAME=<db-name>

## Candidate DB-related env keys, names only
/opt/phone11ai/codex-phone11-deploy/.env:DB_HOST
/opt/phone11ai/codex-phone11-deploy/.env:DB_USER
/opt/phone11ai/codex-phone11-deploy/.env:DB_PASSWORD
/opt/phone11ai/codex-phone11-deploy/.env:DB_NAME
/opt/phone11ai/phone11ai/deploy/backend/.env:DB_HOST
/opt/phone11ai/phone11ai/deploy/backend/.env:DB_USER
/opt/phone11ai/phone11ai/deploy/backend/.env:DB_PASSWORD
/opt/phone11ai/phone11ai/deploy/backend/.env:DB_NAME

## RDS instances, sanitized
### Region ap-southeast-7
----------------------------------------------------------------------------------------------------------------------------------------------------------------
|                                                                      DescribeDBInstances                                                                     |
+-------------------------------+-----------+------------+------------+-------------------------------------------------------------------------------+--------+
|  phone11ai-production-postgres|  postgres |  phone11ai |  phone11ai |  phone11ai-production-postgres.cdk2qyg0ire3.ap-southeast-7.rds.amazonaws.com  |  None  |
+-------------------------------+-----------+------------+------------+-------------------------------------------------------------------------------+--------+
### Region ap-southeast-1
### Region ap-northeast-1
### Region us-east-1

## Secrets Manager candidates, names only
### Region ap-southeast-7
### Region ap-southeast-1
### Region ap-northeast-1
### Region us-east-1

## Read-only errors, sanitized
### phone11-remote-env-error.log
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
