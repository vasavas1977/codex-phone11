# =============================================================================
# NLB Module — CloudPhone11 (SIP/RTP Network Load Balancer)
# =============================================================================

variable "project_name" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "tls_cert_arn" { type = string }
variable "tags" { type = map(string) }

# -----------------------------------------------------------------------------
# Network Load Balancer
# -----------------------------------------------------------------------------
resource "aws_lb" "sip" {
  name               = "${var.project_name}-${var.environment}-sip-nlb"
  internal           = false
  load_balancer_type = "network"
  subnets            = var.public_subnet_ids

  enable_cross_zone_load_balancing = true

  tags = merge(var.tags, {
    Name = "${var.project_name}-${var.environment}-sip-nlb"
  })
}

# -----------------------------------------------------------------------------
# Target Groups
# -----------------------------------------------------------------------------

# SIP UDP (5060)
resource "aws_lb_target_group" "sip_udp" {
  name        = "${var.project_name}-${var.environment}-sip-udp"
  port        = 5060
  protocol    = "UDP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    protocol            = "TCP"
    port                = "5060"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = var.tags
}

# SIP TCP (5060)
resource "aws_lb_target_group" "sip_tcp" {
  name        = "${var.project_name}-${var.environment}-sip-tcp"
  port        = 5060
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    protocol            = "TCP"
    port                = "5060"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = var.tags
}

# SIP TLS (5061)
resource "aws_lb_target_group" "sip_tls" {
  name        = "${var.project_name}-${var.environment}-sip-tls"
  port        = 5061
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    protocol            = "TCP"
    port                = "5061"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = var.tags
}

# WSS (7443)
resource "aws_lb_target_group" "wss" {
  name        = "${var.project_name}-${var.environment}-wss"
  port        = 7443
  protocol    = "TCP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    protocol            = "TCP"
    port                = "7443"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Listeners
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "sip_udp" {
  load_balancer_arn = aws_lb.sip.arn
  port              = 5060
  protocol          = "UDP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sip_udp.arn
  }
}

resource "aws_lb_listener" "sip_tcp" {
  load_balancer_arn = aws_lb.sip.arn
  port              = 5060
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sip_tcp.arn
  }
}

resource "aws_lb_listener" "sip_tls" {
  load_balancer_arn = aws_lb.sip.arn
  port              = 5061
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.tls_cert_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sip_tls.arn
  }
}

resource "aws_lb_listener" "wss" {
  load_balancer_arn = aws_lb.sip.arn
  port              = 7443
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.tls_cert_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.wss.arn
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "nlb_arn" { value = aws_lb.sip.arn }
output "nlb_dns_name" { value = aws_lb.sip.dns_name }
output "nlb_zone_id" { value = aws_lb.sip.zone_id }
output "sip_udp_target_group_arn" { value = aws_lb_target_group.sip_udp.arn }
output "sip_tcp_target_group_arn" { value = aws_lb_target_group.sip_tcp.arn }
output "sip_tls_target_group_arn" { value = aws_lb_target_group.sip_tls.arn }
output "wss_target_group_arn" { value = aws_lb_target_group.wss.arn }
