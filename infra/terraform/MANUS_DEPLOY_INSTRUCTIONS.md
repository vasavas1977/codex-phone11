# CloudPhone11 — Manus Agent Deployment Instructions

This document provides step-by-step instructions for a Manus agent to deploy CloudPhone11 to AWS. The user only needs to provide their AWS credentials when prompted.

---

## Pre-Requisites

The Manus agent must install these tools in the sandbox:

```bash
# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Install Terraform
sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install terraform

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
```

---

## Deployment Steps

### Step 1: Collect User Information

Ask the user for:

| Item | Required | Example |
|------|----------|---------|
| AWS Access Key ID | Yes | `AKIA...` |
| AWS Secret Access Key | Yes | `wJalr...` |
| AWS Region | Yes (default: us-east-1) | `us-east-1` |
| Domain name | Yes | `cloudphone11.io` |
| RDS password | Yes (generate if not provided) | Min 16 chars, alphanumeric |
| FCM server key | Optional (for Android push) | From Firebase Console |
| APNs certificate | Optional (for iOS push) | `.pem` file |

### Step 2: Configure AWS CLI

```bash
aws configure set aws_access_key_id <USER_ACCESS_KEY>
aws configure set aws_secret_access_key <USER_SECRET_KEY>
aws configure set default.region <USER_REGION>

# Verify
aws sts get-caller-identity
```

### Step 3: Create ACM Certificate

```bash
# Request certificate for the domain
aws acm request-certificate \
  --domain-name "*.example.com" \
  --subject-alternative-names "example.com" \
  --validation-method DNS \
  --region <USER_REGION>

# Get the certificate ARN from output
# User must add the DNS validation record to their domain
# Wait for validation: aws acm describe-certificate --certificate-arn <ARN>
```

### Step 4: Create terraform.tfvars

```bash
cd /home/ubuntu/cloudphone11/infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with the user's values:

```hcl
project_name = "cloudphone11"
environment  = "production"
aws_region   = "<USER_REGION>"
domain_name  = "<USER_DOMAIN>"

rds_password = "<GENERATED_OR_USER_PASSWORD>"
tls_cert_arn = "<ACM_CERT_ARN>"

# Optional
fcm_server_key = "<USER_FCM_KEY>"
```

### Step 5: Initialize and Apply Terraform

```bash
cd /home/ubuntu/cloudphone11/infra/terraform

# Initialize
terraform init

# Plan (review output)
terraform plan -out=tfplan

# Apply (takes 15-25 minutes)
terraform apply tfplan
```

**Expected resources created:**
- 1 VPC with 2 public + 2 private subnets
- 2 NAT Gateways
- 1 EKS cluster with 2 node groups (general + voip)
- 1 RDS PostgreSQL instance
- 1 ElastiCache Redis cluster
- 2 S3 buckets (recordings + voicemail)
- 4 ECR repositories
- 1 NLB with 4 listeners (SIP UDP, TCP, TLS, WSS)
- Security groups, IAM roles, OIDC provider
- nginx-ingress controller + cert-manager (via Helm)
- Kubernetes deployments, services, ingress, HPAs

### Step 6: Build and Push Docker Images

```bash
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(terraform output -raw eks_cluster_name | xargs -I{} echo "<USER_REGION>")
ECR_BASE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/cloudphone11"

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Build and push each service
cd /home/ubuntu/cloudphone11

docker build -t "$ECR_BASE/freeswitch:latest" -f infra/docker/freeswitch/Dockerfile infra/docker/freeswitch/
docker push "$ECR_BASE/freeswitch:latest"

docker build -t "$ECR_BASE/kamailio:latest" -f infra/docker/kamailio/Dockerfile infra/docker/kamailio/
docker push "$ECR_BASE/kamailio:latest"

docker build -t "$ECR_BASE/flexisip:latest" -f infra/docker/flexisip/Dockerfile infra/docker/flexisip/
docker push "$ECR_BASE/flexisip:latest"

docker build -t "$ECR_BASE/backend:latest" -f infra/docker/backend/Dockerfile .
docker push "$ECR_BASE/backend:latest"
```

### Step 7: Configure kubectl and Verify

```bash
# Configure kubectl
CLUSTER_NAME=$(terraform -chdir=/home/ubuntu/cloudphone11/infra/terraform output -raw eks_cluster_name)
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION

# Check pods
kubectl -n cloudphone11 get pods

# Wait for all deployments
kubectl -n cloudphone11 wait --for=condition=available --timeout=300s deployment --all
```

### Step 8: DNS Configuration

Tell the user to create these DNS records:

```
sip.<domain>   → CNAME → <NLB DNS from terraform output>
api.<domain>   → CNAME → <nginx-ingress LB DNS>
wss.<domain>   → CNAME → <NLB DNS from terraform output>
push.<domain>  → CNAME → <nginx-ingress LB DNS>
```

Get the values:
```bash
terraform -chdir=/home/ubuntu/cloudphone11/infra/terraform output sip_nlb_dns
kubectl -n ingress-nginx get svc ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### Step 9: Post-Deployment Verification

```bash
# Check all pods are running
kubectl -n cloudphone11 get pods -o wide

# Check services
kubectl -n cloudphone11 get svc

# Check FreeSWITCH
kubectl -n cloudphone11 exec -it deployment/freeswitch -- fs_cli -x "sofia status"

# Check Kamailio
kubectl -n cloudphone11 exec -it deployment/kamailio -- kamctl stats

# Check backend health
kubectl -n cloudphone11 exec -it deployment/backend -- curl -s http://localhost:3000/health
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| EKS nodes not joining | Check IAM roles, security groups, and subnet tags |
| Pods in CrashLoopBackOff | `kubectl -n cloudphone11 logs <pod-name>` |
| NLB not reachable | Check security group allows inbound on 5060/5061/7443 |
| RDS connection refused | Verify security group allows 5432 from VPC CIDR |
| Docker push fails | Re-run ECR login command |
| Terraform state lock | `terraform force-unlock <LOCK_ID>` |

---

## Teardown

To destroy all resources:

```bash
cd /home/ubuntu/cloudphone11/infra/terraform
terraform destroy
```

**Warning:** This will delete all data including recordings and database. Back up first.

---

## Cost Optimization Tips

For development/testing:
- Set `eks_node_desired_size = 2` and `eks_node_min_size = 1`
- Set `rds_multi_az = false`
- Use `db.t3.micro` for RDS
- Use single NAT Gateway (modify VPC module)
- Estimated dev cost: ~$250/month
