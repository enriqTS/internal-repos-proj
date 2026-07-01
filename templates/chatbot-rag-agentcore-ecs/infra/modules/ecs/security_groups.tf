################################################################################
# Security Groups — ECS Tasks
################################################################################

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-${var.environment}-ecs-tasks-sg"
  description = "Security group for ECS Fargate tasks"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-tasks-sg"
  }
}

# Inbound: allow traffic from ALB on container port
resource "aws_vpc_security_group_ingress_rule" "alb_to_ecs" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = var.alb_security_group_id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
  description                  = "Allow inbound from ALB on container port"
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
