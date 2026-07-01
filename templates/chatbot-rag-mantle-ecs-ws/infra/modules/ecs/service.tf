################################################################################
# ECS Fargate Service
################################################################################

resource "aws_ecs_service" "chatbot" {
  name            = "${var.project_name}-${var.environment}-service"
  cluster         = aws_ecs_cluster.chatbot.id
  task_definition = aws_ecs_task_definition.chatbot.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "chatbot"
    container_port   = var.container_port
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-service"
  }
}
