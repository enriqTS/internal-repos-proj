################################################################################
# Security Groups — ECS Tasks (WebSocket Variant)
################################################################################

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-${var.environment}-ecs-tasks-sg"
  description = "Security group for ECS Fargate tasks (WebSocket variant)"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-tasks-sg"
  }
}

# Inbound: allow TCP traffic from NLB on container port.
# NLB preserves source IPs and doesn't use security groups, so we allow
# traffic from the VPC CIDR on the container port.
resource "aws_vpc_security_group_ingress_rule" "nlb_to_ecs" {
  security_group_id = aws_security_group.ecs_tasks.id
  cidr_ipv4         = data.aws_vpc.current.cidr_block
  from_port         = var.container_port
  to_port           = var.container_port
  ip_protocol       = "tcp"
  description       = "Allow inbound from NLB (VPC CIDR) on container port"
}

# Outbound: allow HTTPS to AWS services (port 443)
resource "aws_vpc_security_group_egress_rule" "ecs_to_aws" {
  security_group_id = aws_security_group.ecs_tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "Allow outbound HTTPS to AWS services"
}

data "aws_vpc" "current" {
  id = var.vpc_id
}
