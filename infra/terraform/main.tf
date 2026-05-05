# =============================================================================
# CloudPhone11 — Main Terraform Configuration
# Orchestrates all modules for full AWS deployment
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  # Uncomment and configure for remote state
  # backend "s3" {
  #   bucket         = "cloudphone11-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "cloudphone11-terraform-locks"
  #   encrypt        = true
  # }
}

# -----------------------------------------------------------------------------
# Providers
# -----------------------------------------------------------------------------
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

# -----------------------------------------------------------------------------
# Local values
# -----------------------------------------------------------------------------
locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# =============================================================================
# Module: VPC
# =============================================================================
module "vpc" {
  source = "./modules/vpc"

  project_name         = var.project_name
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  tags                 = local.common_tags
}

# =============================================================================
# Module: Security Groups
# =============================================================================
module "security_groups" {
  source = "./modules/security-groups"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  vpc_cidr     = module.vpc.vpc_cidr
  rtp_port_min = var.rtp_port_min
  rtp_port_max = var.rtp_port_max
  tags         = local.common_tags
}

# =============================================================================
# Module: EKS
# =============================================================================
module "eks" {
  source = "./modules/eks"

  project_name        = var.project_name
  environment         = var.environment
  cluster_version     = var.eks_cluster_version
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  public_subnet_ids   = module.vpc.public_subnet_ids
  cluster_sg_id       = module.security_groups.eks_cluster_sg_id
  sip_sg_id           = module.security_groups.sip_sg_id
  node_instance_types = var.eks_node_instance_types
  node_desired_size   = var.eks_node_desired_size
  node_min_size       = var.eks_node_min_size
  node_max_size       = var.eks_node_max_size
  node_disk_size      = var.eks_node_disk_size
  tags                = local.common_tags
}

# =============================================================================
# Module: RDS (PostgreSQL)
# =============================================================================
module "rds" {
  source = "./modules/rds"

  project_name          = var.project_name
  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  security_group_id     = module.security_groups.rds_sg_id
  instance_class        = var.rds_instance_class
  allocated_storage     = var.rds_allocated_storage
  max_allocated_storage = var.rds_max_allocated_storage
  multi_az              = var.rds_multi_az
  db_name               = var.rds_db_name
  username              = var.rds_username
  password              = var.rds_password
  tags                  = local.common_tags
}

# =============================================================================
# Module: ElastiCache (Redis)
# =============================================================================
module "elasticache" {
  source = "./modules/elasticache"

  project_name       = var.project_name
  environment        = var.environment
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_id  = module.security_groups.redis_sg_id
  node_type          = var.redis_node_type
  num_cache_nodes    = var.redis_num_cache_nodes
  tags               = local.common_tags
}

# =============================================================================
# Module: S3 (Recordings & Voicemail)
# =============================================================================
module "s3" {
  source = "./modules/s3"

  project_name   = var.project_name
  environment    = var.environment
  retention_days = var.recordings_retention_days
  glacier_days   = var.recordings_glacier_days
  expiry_days    = var.recordings_expiry_days
  tags           = local.common_tags
}

# =============================================================================
# Module: ECR (Container Registries)
# =============================================================================
module "ecr" {
  source = "./modules/ecr"

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags
}

# =============================================================================
# Module: NLB (SIP Traffic)
# =============================================================================
module "nlb" {
  source = "./modules/nlb"

  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  tls_cert_arn      = var.tls_cert_arn
  tags              = local.common_tags
}

# =============================================================================
# Helm: nginx-ingress controller
# =============================================================================
resource "helm_release" "nginx_ingress" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  namespace        = "ingress-nginx"
  create_namespace = true
  version          = "4.9.0"

  set {
    name  = "controller.service.type"
    value = "LoadBalancer"
  }

  set {
    name  = "controller.service.annotations.service\\.beta\\.kubernetes\\.io/aws-load-balancer-type"
    value = "nlb"
  }

  set {
    name  = "controller.service.annotations.service\\.beta\\.kubernetes\\.io/aws-load-balancer-scheme"
    value = "internet-facing"
  }

  depends_on = [module.eks]
}

# =============================================================================
# Helm: cert-manager (for automatic TLS)
# =============================================================================
resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  namespace        = "cert-manager"
  create_namespace = true
  version          = "1.14.0"

  set {
    name  = "installCRDs"
    value = "true"
  }

  depends_on = [module.eks]
}
