# =============================================================================
# Security Groups Module — CloudPhone11
# =============================================================================

variable "project_name" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "rtp_port_min" { type = number }
variable "rtp_port_max" { type = number }
variable "tags" { type = map(string) }

# -----------------------------------------------------------------------------
# EKS Cluster Security Group (additional rules)
# -----------------------------------------------------------------------------
resource "aws_security_group" "eks_cluster" {
  name_prefix = "${var.project_name}-${var.environment}-eks-cluster-"
  vpc_id      = var.vpc_id
  description = "EKS cluster additional security group"

  ingress {
    description = "Allow HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-eks-cluster-sg"
  })

  lifecycle { create_before_destroy = true }
}

# -----------------------------------------------------------------------------
# SIP / VoIP Security Group (for NLB targets)
# -----------------------------------------------------------------------------
resource "aws_security_group" "sip" {
  name_prefix = "${var.project_name}-${var.environment}-sip-"
  vpc_id      = var.vpc_id
  description = "SIP signaling and media traffic"

  # SIP UDP
  ingress {
    description = "SIP UDP"
    from_port   = 5060
    to_port     = 5060
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SIP TCP
  ingress {
    description = "SIP TCP"
    from_port   = 5060
    to_port     = 5060
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SIP TLS
  ingress {
    description = "SIP TLS"
    from_port   = 5061
    to_port     = 5061
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # WSS (WebSocket Secure for WebRTC/mobile)
  ingress {
    description = "SIP over WSS"
    from_port   = 7443
    to_port     = 7443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # RTP media ports
  ingress {
    description = "RTP media UDP"
    from_port   = var.rtp_port_min
    to_port     = var.rtp_port_max
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-sip-sg"
  })

  lifecycle { create_before_destroy = true }
}

# -----------------------------------------------------------------------------
# RDS Security Group
# -----------------------------------------------------------------------------
resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-${var.environment}-rds-"
  vpc_id      = var.vpc_id
  description = "PostgreSQL access from VPC only"

  ingress {
    description = "PostgreSQL from VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-rds-sg"
  })

  lifecycle { create_before_destroy = true }
}

# -----------------------------------------------------------------------------
# ElastiCache Security Group
# -----------------------------------------------------------------------------
resource "aws_security_group" "redis" {
  name_prefix = "${var.project_name}-${var.environment}-redis-"
  vpc_id      = var.vpc_id
  description = "Redis access from VPC only"

  ingress {
    description = "Redis from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-redis-sg"
  })

  lifecycle { create_before_destroy = true }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "eks_cluster_sg_id" { value = aws_security_group.eks_cluster.id }
output "sip_sg_id" { value = aws_security_group.sip.id }
output "rds_sg_id" { value = aws_security_group.rds.id }
output "redis_sg_id" { value = aws_security_group.redis.id }
