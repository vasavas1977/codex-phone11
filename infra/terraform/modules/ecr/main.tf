# =============================================================================
# ECR Module — CloudPhone11 (Container Registries)
# =============================================================================

variable "project_name" { type = string }
variable "environment" { type = string }
variable "tags" { type = map(string) }

locals {
  repositories = ["freeswitch", "kamailio", "flexisip", "backend"]
}

# -----------------------------------------------------------------------------
# ECR Repositories
# -----------------------------------------------------------------------------
resource "aws_ecr_repository" "services" {
  for_each = toset(local.repositories)

  name                 = "${var.project_name}/${each.value}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, {
    Name    = "${var.project_name}-${each.value}"
    Service = each.value
  })
}

# -----------------------------------------------------------------------------
# Lifecycle Policy (keep last 10 images)
# -----------------------------------------------------------------------------
resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = toset(local.repositories)
  repository = aws_ecr_repository.services[each.value].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Remove untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "repository_urls" {
  value = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "registry_id" {
  value = values(aws_ecr_repository.services)[0].registry_id
}
