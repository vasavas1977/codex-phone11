# =============================================================================
# S3 Module — CloudPhone11 (Call Recordings + Voicemail)
# =============================================================================

variable "project_name" { type = string }
variable "environment" { type = string }
variable "retention_days" { type = number }
variable "glacier_days" { type = number }
variable "expiry_days" { type = number }
variable "tags" { type = map(string) }

# -----------------------------------------------------------------------------
# Recordings Bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "recordings" {
  bucket = "${var.project_name}-${var.environment}-recordings"

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-recordings"
  })
}

resource "aws_s3_bucket_versioning" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "recordings" {
  bucket                  = aws_s3_bucket.recordings.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    id     = "recordings-lifecycle"
    status = "Enabled"

    # Move to Infrequent Access
    transition {
      days          = var.retention_days
      storage_class = "STANDARD_IA"
    }

    # Move to Glacier (if enabled)
    dynamic "transition" {
      for_each = var.glacier_days > 0 ? [1] : []
      content {
        days          = var.glacier_days
        storage_class = "GLACIER"
      }
    }

    # Expire (if enabled)
    dynamic "expiration" {
      for_each = var.expiry_days > 0 ? [1] : []
      content {
        days = var.expiry_days
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Voicemail Bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "voicemail" {
  bucket = "${var.project_name}-${var.environment}-voicemail"

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-voicemail"
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "voicemail" {
  bucket = aws_s3_bucket.voicemail.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "voicemail" {
  bucket                  = aws_s3_bucket.voicemail.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "voicemail" {
  bucket = aws_s3_bucket.voicemail.id

  rule {
    id     = "voicemail-lifecycle"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 365
    }
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "recordings_bucket_name" { value = aws_s3_bucket.recordings.id }
output "recordings_bucket_arn" { value = aws_s3_bucket.recordings.arn }
output "voicemail_bucket_name" { value = aws_s3_bucket.voicemail.id }
output "voicemail_bucket_arn" { value = aws_s3_bucket.voicemail.arn }
