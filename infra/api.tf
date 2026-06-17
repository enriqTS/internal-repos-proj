# =============================================================================
# API Gateway + Lambda infrastructure for the /upload endpoint
# =============================================================================

# -----------------------------------------------------------------------------
# IAM Role for the Upload Lambda
# -----------------------------------------------------------------------------

resource "aws_iam_role" "lambda_role" {
  name = "${var.bucket_name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "${var.bucket_name_prefix}-lambda-role"
    Project = "internal-repos"
  }
}

resource "aws_iam_role_policy" "lambda_s3_policy" {
  name = "${var.bucket_name_prefix}-lambda-s3-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:HeadObject"
        ]
        Resource = [
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_logs_policy" {
  name = "${var.bucket_name_prefix}-lambda-logs-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Lambda Function
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "upload_lambda" {
  function_name = "${var.bucket_name_prefix}-upload"
  role          = aws_iam_role.lambda_role.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"
  memory_size   = 512
  timeout       = 30

  filename         = var.lambda_source_path
  source_code_hash = filebase64sha256(var.lambda_source_path)

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.frontend.id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-upload-lambda"
    Project = "internal-repos"
  }
}

# -----------------------------------------------------------------------------
# API Gateway REST API
# -----------------------------------------------------------------------------

resource "aws_api_gateway_rest_api" "api" {
  name        = "${var.bucket_name_prefix}-api"
  description = "Internal Repos upload API"

  tags = {
    Name    = "${var.bucket_name_prefix}-api"
    Project = "internal-repos"
  }
}

resource "aws_api_gateway_resource" "upload" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "upload"
}

resource "aws_api_gateway_method" "upload_post" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.upload.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "lambda_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.upload.id
  http_method             = aws_api_gateway_method.upload_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.upload_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# -----------------------------------------------------------------------------
# API Gateway Deployment and Stage
# -----------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "api_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  depends_on = [
    aws_api_gateway_integration.lambda_integration
  ]

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.upload.id,
      aws_api_gateway_method.upload_post.id,
      aws_api_gateway_integration.lambda_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "prod" {
  deployment_id = aws_api_gateway_deployment.api_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.api.id
  stage_name    = "prod"

  tags = {
    Name    = "${var.bucket_name_prefix}-api-prod"
    Project = "internal-repos"
  }
}

# -----------------------------------------------------------------------------
# API Key and Usage Plan
# -----------------------------------------------------------------------------

resource "aws_api_gateway_api_key" "upload_key" {
  name    = "${var.bucket_name_prefix}-upload-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "upload_plan" {
  name = "${var.bucket_name_prefix}-upload-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.api.id
    stage  = aws_api_gateway_stage.prod.stage_name
  }

  throttle_settings {
    burst_limit = 10
    rate_limit  = 5
  }

  quota_settings {
    limit  = 1000
    period = "DAY"
  }
}

resource "aws_api_gateway_usage_plan_key" "upload_plan_key" {
  key_id        = aws_api_gateway_api_key.upload_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.upload_plan.id
}
