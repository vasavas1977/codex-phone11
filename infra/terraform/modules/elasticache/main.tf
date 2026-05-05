# =============================================================================
# ElastiCache Redis Module — CloudPhone11
# =============================================================================

variable "project_name" { type = string }
variable "environment" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "node_type" { type = string }
variable "num_cache_nodes" { type = number }
variable "tags" { type = map(string) }

# -----------------------------------------------------------------------------
# Subnet Group
# -----------------------------------------------------------------------------
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = var.private_subnet_ids

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Redis Cluster
# -----------------------------------------------------------------------------
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.project_name}-${var.environment}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_nodes      = var.num_cache_nodes
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.security_group_id]

  snapshot_retention_limit = var.environment == "production" ? 3 : 0
  snapshot_window          = "02:00-03:00"
  maintenance_window       = "sun:03:00-sun:04:00"

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-redis"
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "endpoint" { value = aws_elasticache_cluster.main.cache_nodes[0].address }
output "port" { value = aws_elasticache_cluster.main.cache_nodes[0].port }
output "connection_string" { value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}" }
