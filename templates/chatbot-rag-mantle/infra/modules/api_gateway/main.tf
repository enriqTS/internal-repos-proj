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
  deployment_id         = aws_api_gateway_deployment.chatbot.id
  rest_api_id           = aws_api_gateway_rest_api.chatbot.id
  stage_name            = var.stage_name
  xray_tracing_enabled  = true
  cache_cluster_enabled = var.cache_enabled
  cache_cluster_size    = var.cache_size
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.chatbot.id
  stage_name  = aws_api_gateway_stage.chatbot.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }
}

resource "aws_api_gateway_usage_plan" "main" {
  name = "${var.project_prefix}-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.chatbot.id
    stage  = aws_api_gateway_stage.chatbot.stage_name
  }

  throttle_settings {
    rate_limit  = var.throttle_rate_limit
    burst_limit = var.throttle_burst_limit
  }

  quota_settings {
    limit  = var.quota_limit
    period = "DAY"
  }
}

resource "aws_api_gateway_api_key" "default" {
  name    = "${var.project_prefix}-default-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan_key" "default" {
  key_id        = aws_api_gateway_api_key.default.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.main.id
}

resource "aws_lambda_permission" "apigw_invoke_responses_reader" {
  statement_id  = "AllowAPIGatewayInvokeResponsesReader"
  action        = "lambda:InvokeFunction"
  function_name = var.responses_reader_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.chatbot.execution_arn}/*/*"
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
