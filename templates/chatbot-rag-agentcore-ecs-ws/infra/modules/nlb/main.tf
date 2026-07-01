################################################################################
# Network Load Balancer — WebSocket ECS Variants
#
# Uses TCP (Layer 4) for WebSocket-compatible routing via API Gateway VPC Link.
# Unlike ALB, NLB supports direct TCP pass-through needed for API Gateway
# WebSocket integration via VPC Link.
################################################################################

resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-nlb"
  internal           = true
  load_balancer_type = "network"
  subnets            = var.private_subnet_ids

  enable_cross_zone_load_balancing = true

  tags = {
    Name = "${var.project_name}-${var.environment}-nlb"
  }
}

resource "aws_lb_target_group" "chatbot" {
  name                 = "${var.project_name}-${var.environment}-nlb-tg"
  port                 = var.container_port
  protocol             = "TCP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = var.deregistration_delay

  health_check {
    enabled             = true
    port                = var.container_port
    protocol            = "HTTP"
    path                = "/health"
    interval            = var.health_check_interval
    timeout             = var.health_check_timeout
    healthy_threshold   = var.healthy_threshold
    unhealthy_threshold = var.unhealthy_threshold
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-nlb-tg"
  }
}

resource "aws_lb_listener" "tcp" {
  load_balancer_arn = aws_lb.main.arn
  port              = var.container_port
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.chatbot.arn
  }
}
