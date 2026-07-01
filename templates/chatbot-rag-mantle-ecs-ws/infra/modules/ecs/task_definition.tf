################################################################################
# ECS Task Definition
################################################################################

resource "aws_cloudwatch_log_group" "chatbot" {
  name              = "${var.project_name}-${var.environment}-chatbot-logs"
  retention_in_days = 30

  tags = {
    Name = "${var.project_name}-${var.environment}-chatbot-logs"
  }
}

resource "aws_ecs_task_definition" "chatbot" {
  family                   = "${var.project_name}-${var.environment}-chatbot"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu_units
  memory                   = var.memory_mib
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name  = "chatbot"
    image = "${var.ecr_repository_url}:latest"

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      { name = "PORT", value = tostring(var.container_port) },
      { name = "POWERTOOLS_SERVICE_NAME", value = "chatbot-ecs-ws" },
      { name = "POWERTOOLS_LOG_LEVEL", value = var.log_level },
      { name = "DYNAMODB_TABLE_NAME", value = var.dynamodb_table_name },
      { name = "CONNECTION_TABLE_NAME", value = var.connection_table_name },
      { name = "RAG_BUCKET_NAME", value = var.rag_bucket_name },
      { name = "MAX_CONVERSATION_HISTORY", value = tostring(var.max_conversation_history) },
      { name = "MAX_TOOL_ITERATIONS", value = tostring(var.max_tool_iterations) },
      { name = "MANTLE_BASE_URL", value = var.mantle_base_url },
      { name = "MODEL_ID", value = var.model_id },
      { name = "WEBSOCKET_API_ENDPOINT", value = var.websocket_api_endpoint },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.chatbot.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    stopTimeout = 30

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = {
    Name = "${var.project_name}-${var.environment}-chatbot"
  }
}
