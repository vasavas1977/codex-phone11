#!/usr/bin/env bash
# =============================================================================
# CloudPhone11 — Automated Deployment Script
# Run this script to deploy the full CloudPhone11 stack to AWS
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INFRA_DIR="$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# =============================================================================
# Step 0: Pre-flight checks
# =============================================================================
log "Running pre-flight checks..."

command -v aws >/dev/null 2>&1 || error "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
command -v terraform >/dev/null 2>&1 || error "Terraform not found. Install: https://developer.hashicorp.com/terraform/install"
command -v docker >/dev/null 2>&1 || error "Docker not found. Install: https://docs.docker.com/get-docker/"
command -v kubectl >/dev/null 2>&1 || error "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/"

# Verify AWS credentials
aws sts get-caller-identity >/dev/null 2>&1 || error "AWS credentials not configured. Run: aws configure"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(grep -E '^aws_region' "$INFRA_DIR/terraform.tfvars" 2>/dev/null | awk -F'"' '{print $2}' || echo "us-east-1")

ok "AWS Account: $AWS_ACCOUNT_ID | Region: $AWS_REGION"

# =============================================================================
# Step 1: Check for terraform.tfvars
# =============================================================================
if [ ! -f "$INFRA_DIR/terraform.tfvars" ]; then
  warn "terraform.tfvars not found. Creating from example..."
  cp "$INFRA_DIR/terraform.tfvars.example" "$INFRA_DIR/terraform.tfvars"
  warn "IMPORTANT: Edit $INFRA_DIR/terraform.tfvars with your values before continuing."
  warn "At minimum, set: domain_name, rds_password, tls_cert_arn"
  read -p "Press Enter after editing terraform.tfvars, or Ctrl+C to abort..."
fi

# =============================================================================
# Step 2: Terraform Init & Plan
# =============================================================================
log "Initializing Terraform..."
cd "$INFRA_DIR"
terraform init -upgrade

log "Planning infrastructure..."
terraform plan -out=tfplan

read -p "Review the plan above. Apply? (y/N): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  error "Deployment cancelled by user."
fi

# =============================================================================
# Step 3: Terraform Apply (Infrastructure)
# =============================================================================
log "Applying infrastructure (this takes 15-25 minutes)..."
terraform apply tfplan
rm -f tfplan

ok "Infrastructure provisioned successfully!"

# =============================================================================
# Step 4: Build & Push Docker Images
# =============================================================================
log "Building and pushing Docker images to ECR..."

# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

PROJECT_NAME=$(terraform output -raw eks_cluster_name 2>/dev/null | sed 's/-production$//' || echo "cloudphone11")
ECR_BASE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$PROJECT_NAME"

# Build FreeSWITCH
log "Building FreeSWITCH image..."
docker build -t "$ECR_BASE/freeswitch:latest" -f "$PROJECT_ROOT/infra/docker/freeswitch/Dockerfile" "$PROJECT_ROOT/infra/docker/freeswitch/"
docker push "$ECR_BASE/freeswitch:latest"
ok "FreeSWITCH image pushed"

# Build Kamailio
log "Building Kamailio image..."
docker build -t "$ECR_BASE/kamailio:latest" -f "$PROJECT_ROOT/infra/docker/kamailio/Dockerfile" "$PROJECT_ROOT/infra/docker/kamailio/"
docker push "$ECR_BASE/kamailio:latest"
ok "Kamailio image pushed"

# Build Flexisip
log "Building Flexisip image..."
docker build -t "$ECR_BASE/flexisip:latest" -f "$PROJECT_ROOT/infra/docker/flexisip/Dockerfile" "$PROJECT_ROOT/infra/docker/flexisip/"
docker push "$ECR_BASE/flexisip:latest"
ok "Flexisip image pushed"

# Build Backend
log "Building Backend API image..."
docker build -t "$ECR_BASE/backend:latest" -f "$PROJECT_ROOT/infra/docker/backend/Dockerfile" "$PROJECT_ROOT/"
docker push "$ECR_BASE/backend:latest"
ok "Backend image pushed"

# =============================================================================
# Step 5: Configure kubectl
# =============================================================================
log "Configuring kubectl..."
CLUSTER_NAME=$(terraform output -raw eks_cluster_name)
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"
ok "kubectl configured for cluster: $CLUSTER_NAME"

# =============================================================================
# Step 6: Verify Deployments
# =============================================================================
log "Waiting for deployments to be ready (up to 5 minutes)..."

kubectl -n "$PROJECT_NAME" wait --for=condition=available --timeout=300s deployment/backend || warn "Backend not ready yet"
kubectl -n "$PROJECT_NAME" wait --for=condition=available --timeout=300s deployment/kamailio || warn "Kamailio not ready yet"
kubectl -n "$PROJECT_NAME" wait --for=condition=available --timeout=300s deployment/flexisip || warn "Flexisip not ready yet"
kubectl -n "$PROJECT_NAME" wait --for=condition=available --timeout=300s deployment/freeswitch || warn "FreeSWITCH not ready yet"

# =============================================================================
# Step 7: Print Summary
# =============================================================================
echo ""
echo "============================================================================="
echo -e "${GREEN}  CloudPhone11 Deployment Complete!${NC}"
echo "============================================================================="
echo ""
echo "  Cluster:     $(terraform output -raw eks_cluster_name)"
echo "  Region:      $AWS_REGION"
echo "  SIP NLB:     $(terraform output -raw sip_nlb_dns)"
echo "  RDS:         $(terraform output -raw rds_endpoint)"
echo "  Redis:       $(terraform output -raw redis_endpoint)"
echo "  Recordings:  $(terraform output -raw recordings_bucket)"
echo "  Voicemail:   $(terraform output -raw voicemail_bucket)"
echo ""
echo "  ECR Repos:"
terraform output -json ecr_repository_urls | python3 -c "
import json, sys
for k,v in json.load(sys.stdin).items():
    print(f'    {k}: {v}')
" 2>/dev/null || echo "    (run 'terraform output ecr_repository_urls' to view)"
echo ""
echo "  DNS Records Needed:"
terraform output -json dns_records_needed | python3 -c "
import json, sys
for k,v in json.load(sys.stdin).items():
    print(f'    {k} → {v}')
" 2>/dev/null || echo "    (run 'terraform output dns_records_needed' to view)"
echo ""
echo "  Pod Status:"
kubectl -n "$PROJECT_NAME" get pods -o wide 2>/dev/null || echo "    (run 'kubectl -n $PROJECT_NAME get pods' to check)"
echo ""
echo "============================================================================="
echo -e "${YELLOW}  NEXT STEPS:${NC}"
echo "  1. Create DNS records (see above)"
echo "  2. Configure SIP trunks in Kamailio for PSTN connectivity"
echo "  3. Update the mobile app's SIP server URL to sip.${DOMAIN_NAME:-yourdomain.com}"
echo "  4. Test registration and calls"
echo "============================================================================="
