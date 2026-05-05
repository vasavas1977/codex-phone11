# =============================================================================
# CloudPhone11 — Terraform Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# VPC
# -----------------------------------------------------------------------------
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnet_ids
}

output "nat_gateway_ips" {
  description = "NAT Gateway public IPs"
  value       = module.vpc.nat_gateway_ips
}

# -----------------------------------------------------------------------------
# EKS
# -----------------------------------------------------------------------------
output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
}

output "eks_kubeconfig_command" {
  description = "Command to configure kubectl"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.aws_region}"
}

# -----------------------------------------------------------------------------
# RDS
# -----------------------------------------------------------------------------
output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.endpoint
}

output "rds_connection_string" {
  description = "RDS connection string"
  value       = module.rds.connection_string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# ElastiCache
# -----------------------------------------------------------------------------
output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.elasticache.endpoint
}

output "redis_connection_string" {
  description = "Redis connection string"
  value       = module.elasticache.connection_string
}

# -----------------------------------------------------------------------------
# S3
# -----------------------------------------------------------------------------
output "recordings_bucket" {
  description = "S3 bucket for call recordings"
  value       = module.s3.recordings_bucket_name
}

output "voicemail_bucket" {
  description = "S3 bucket for voicemail"
  value       = module.s3.voicemail_bucket_name
}

# -----------------------------------------------------------------------------
# ECR
# -----------------------------------------------------------------------------
output "ecr_repository_urls" {
  description = "ECR repository URLs for Docker images"
  value       = module.ecr.repository_urls
}

# -----------------------------------------------------------------------------
# NLB (SIP)
# -----------------------------------------------------------------------------
output "sip_nlb_dns" {
  description = "NLB DNS name for SIP traffic"
  value       = module.nlb.nlb_dns_name
}

# -----------------------------------------------------------------------------
# DNS Records to Create
# -----------------------------------------------------------------------------
output "dns_records_needed" {
  description = "DNS records to create for your domain"
  value = {
    "sip.${var.domain_name}"  = "CNAME → ${module.nlb.nlb_dns_name} (SIP signaling)"
    "api.${var.domain_name}"  = "CNAME → nginx-ingress LB (Backend API)"
    "wss.${var.domain_name}"  = "CNAME → ${module.nlb.nlb_dns_name} (WebSocket SIP)"
    "push.${var.domain_name}" = "CNAME → nginx-ingress LB (Flexisip push gateway)"
  }
}
