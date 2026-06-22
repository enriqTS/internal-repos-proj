resource "aws_api_gateway_rest_api" "chatbot" {
  name        = "${var.project_prefix}-entry-api"
  description = "Chatbot RAG REST API"
  body        = var.openapi_spec

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_deployment" "chatbot" {
  rest_api_id = aws_api_gateway_rest_api.chatbot.id

  triggers = {
    redeployment = sha256(var.openapi_spec)
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "chatbot" {
  deployment_id = aws_api_gateway_deployment.chatbot.id
  rest_api_id   = aws_api_gateway_rest_api.chatbot.id
  stage_name    = var.stage_name
}

# IAM role for API Gateway to send messages to SQS
resource "aws_iam_role" "api_gateway" {
  name = "${var.project_prefix}-apigw-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_gateway_sqs" {
  name = "${var.project_prefix}-apigw-sqs-policy"
  role = aws_iam_role.api_gateway.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [var.sqs_queue_arn]
      }
    ]
  })
}
