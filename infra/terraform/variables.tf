# =============================================================================
# CloudPhone11 — Terraform Variables
# =============================================================================

# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------
variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "cloudphone11"
}

variable "environment" {
  description = "Deployment environment (dev, staging, production)"
  type        = string
  default     = "production"
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Root domain for CloudPhone11 (e.g., cloudphone11.io)"
  type        = string
}

# -----------------------------------------------------------------------------
# VPC / Networking
# -----------------------------------------------------------------------------
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones (minimum 2)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

# -----------------------------------------------------------------------------
# EKS
# -----------------------------------------------------------------------------
variable "eks_cluster_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.29"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for EKS managed node group"
  type        = list(string)
  default     = ["m5.xlarge"]
}

variable "eks_node_desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 3
}

variable "eks_node_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 2
}

variable "eks_node_max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 6
}

variable "eks_node_disk_size" {
  description = "Disk size in GB for EKS worker nodes"
  type        = number
  default     = 100
}

# -----------------------------------------------------------------------------
# RDS (PostgreSQL)
# -----------------------------------------------------------------------------
variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB for RDS"
  type        = number
  default     = 50
}

variable "rds_max_allocated_storage" {
  description = "Maximum storage autoscaling limit in GB"
  type        = number
  default     = 200
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = true
}

variable "rds_db_name" {
  description = "Database name"
  type        = string
  default     = "cloudphone11"
}

variable "rds_username" {
  description = "Master username for RDS"
  type        = string
  default     = "cloudphone11"
}

variable "rds_password" {
  description = "Master password for RDS (min 16 characters)"
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# ElastiCache (Redis)
# -----------------------------------------------------------------------------
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.small"
}

variable "redis_num_cache_nodes" {
  description = "Number of Redis cache nodes"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# S3 (Recordings)
# -----------------------------------------------------------------------------
variable "recordings_retention_days" {
  description = "Days before moving recordings to Infrequent Access"
  type        = number
  default     = 30
}

variable "recordings_glacier_days" {
  description = "Days before moving recordings to Glacier (0 to disable)"
  type        = number
  default     = 180
}

variable "recordings_expiry_days" {
  description = "Days before permanently deleting recordings (0 to disable)"
  type        = number
  default     = 365
}

# -----------------------------------------------------------------------------
# SIP / VoIP
# -----------------------------------------------------------------------------
variable "sip_external_ip" {
  description = "Public IP for SIP signaling (leave empty to use NLB IP)"
  type        = string
  default     = ""
}

variable "rtp_port_min" {
  description = "Minimum RTP port range"
  type        = number
  default     = 20000
}

variable "rtp_port_max" {
  description = "Maximum RTP port range"
  type        = number
  default     = 30000
}

# -----------------------------------------------------------------------------
# Push Notifications
# -----------------------------------------------------------------------------
variable "fcm_server_key" {
  description = "Firebase Cloud Messaging server key for Android push"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apns_cert_path" {
  description = "Path to APNs certificate PEM file for iOS push"
  type        = string
  default     = ""
}

variable "apns_use_sandbox" {
  description = "Use APNs sandbox (development) endpoint"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# TLS
# -----------------------------------------------------------------------------
variable "tls_cert_arn" {
  description = "ACM certificate ARN for the domain (leave empty to create new)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
