# ECS Task Execution Role — for pulling images from ECR and writing to CloudWatch Logs
resource "aws_iam_role" "execution" {
  name = "${var.project_name}-${var.environment}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "execution_ecr" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS Task Role — for the application to access AWS services (least privilege)
resource "aws_iam_role" "task" {
  name = "${var.project_name}-${var.environment}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ecs-task-role"
  }
}

resource "aws_iam_role_policy" "task_dynamodb" {
  name = "${var.project_name}-${var.environment}-dynamodb-access"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ]
        Resource = [
          var.dynamodb_table_arn,
          var.connections_table_arn,
          "${var.connections_table_arn}/index/*",
        ]
      },
    ]
  })
}

resource "aws_iam_role_policy" "task_s3" {
  name = "${var.project_name}-${var.environment}-s3-access"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:ListBucket",
      ]
      Resource = [
        var.rag_bucket_arn,
        "${var.rag_bucket_arn}/*",
      ]
    }]
  })
}

resource "aws_iam_role_policy" "task_bedrock" {
  name = "${var.project_name}-${var.environment}-bedrock-access"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeAgent",
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = "*"
    }]
  })
}

# execute-api:ManageConnections — for sending messages via @connections
resource "aws_iam_role_policy" "task_apigw_manage_connections" {
  name = "${var.project_name}-${var.environment}-apigw-manage-connections"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "execute-api:ManageConnections",
      ]
      Resource = "${var.websocket_api_stage_arn}/POST/@connections/*"
    }]
  })
}
