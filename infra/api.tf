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
          "s3:HeadObject",
          "s3:DeleteObject",
          "s3:CopyObject"
        ]
        Resource = [
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_staging_s3_policy" {
  name = "${var.bucket_name_prefix}-lambda-staging-s3-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.staging.arn}/staging/*"
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
# Lambda Deployment Package
# -----------------------------------------------------------------------------

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/dist"
  output_path = "${path.module}/lambda.zip"
}

# -----------------------------------------------------------------------------
# Lambda Functions
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "initiate_lambda" {
  function_name = "${var.bucket_name_prefix}-initiate"
  role          = aws_iam_role.lambda_role.arn
  handler       = "initiate.handler"
  runtime       = "nodejs22.x"
  memory_size   = 256
  timeout       = 10

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME    = aws_s3_bucket.frontend.id
      STAGING_BUCKET = aws_s3_bucket.staging.id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-initiate-lambda"
    Project = "internal-repos"
  }
}

resource "aws_lambda_function" "process_lambda" {
  function_name = "${var.bucket_name_prefix}-process"
  role          = aws_iam_role.lambda_role.arn
  handler       = "process.handler"
  runtime       = "nodejs22.x"
  memory_size   = 1024
  timeout       = 120

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME    = aws_s3_bucket.frontend.id
      STAGING_BUCKET = aws_s3_bucket.staging.id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-process-lambda"
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

resource "aws_api_gateway_resource" "upload_initiate" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.upload.id
  path_part   = "initiate"
}

resource "aws_api_gateway_resource" "upload_finalize" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.upload.id
  path_part   = "finalize"
}

# -----------------------------------------------------------------------------
# POST /upload/initiate → Initiate Lambda
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "initiate_post" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.upload_initiate.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "initiate_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.upload_initiate.id
  http_method             = aws_api_gateway_method.initiate_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.initiate_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# POST /upload/finalize → Processing Lambda
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "finalize_post" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.upload_finalize.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "finalize_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.upload_finalize.id
  http_method             = aws_api_gateway_method.finalize_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.process_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# CORS: OPTIONS on /upload/initiate
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "initiate_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.upload_initiate.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "initiate_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_initiate.id
  http_method = aws_api_gateway_method.initiate_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "initiate_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_initiate.id
  http_method = aws_api_gateway_method.initiate_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "initiate_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_initiate.id
  http_method = aws_api_gateway_method.initiate_options.http_method
  status_code = aws_api_gateway_method_response.initiate_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# -----------------------------------------------------------------------------
# CORS: OPTIONS on /upload/finalize
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "finalize_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.upload_finalize.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "finalize_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_finalize.id
  http_method = aws_api_gateway_method.finalize_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "finalize_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_finalize.id
  http_method = aws_api_gateway_method.finalize_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "finalize_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.upload_finalize.id
  http_method = aws_api_gateway_method.finalize_options.http_method
  status_code = aws_api_gateway_method_response.finalize_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# -----------------------------------------------------------------------------
# Lambda Permissions for API Gateway
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "apigw_invoke_initiate" {
  statement_id  = "AllowAPIGatewayInvokeInitiate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.initiate_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_invoke_process" {
  statement_id  = "AllowAPIGatewayInvokeProcess"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.process_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# =============================================================================
# API Gateway + Lambda infrastructure for /projects/{name} endpoints (Edit/Delete)
# =============================================================================

# -----------------------------------------------------------------------------
# Lambda Functions - Edit and Delete
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "edit_lambda" {
  function_name = "${var.bucket_name_prefix}-edit"
  role          = aws_iam_role.lambda_role.arn
  handler       = "edit.handler"
  runtime       = "nodejs22.x"
  memory_size   = 256
  timeout       = 30

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.frontend.id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-edit-lambda"
    Project = "internal-repos"
  }
}

resource "aws_lambda_function" "delete_lambda" {
  function_name = "${var.bucket_name_prefix}-delete"
  role          = aws_iam_role.lambda_role.arn
  handler       = "delete.handler"
  runtime       = "nodejs22.x"
  memory_size   = 256
  timeout       = 10

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.frontend.id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-delete-lambda"
    Project = "internal-repos"
  }
}

# -----------------------------------------------------------------------------
# API Gateway Resources: /projects and /projects/{name}
# -----------------------------------------------------------------------------

resource "aws_api_gateway_resource" "projects" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "projects"
}

resource "aws_api_gateway_resource" "projects_name" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.projects.id
  path_part   = "{name}"
}

# -----------------------------------------------------------------------------
# PATCH /projects/{name} → Edit Lambda
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "projects_name_patch" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.projects_name.id
  http_method      = "PATCH"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "projects_name_patch_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.projects_name.id
  http_method             = aws_api_gateway_method.projects_name_patch.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.edit_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# DELETE /projects/{name} → Delete Lambda
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "projects_name_delete" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.projects_name.id
  http_method      = "DELETE"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "projects_name_delete_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.projects_name.id
  http_method             = aws_api_gateway_method.projects_name_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.delete_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# CORS: OPTIONS on /projects/{name}
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "projects_name_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.projects_name.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "projects_name_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.projects_name.id
  http_method = aws_api_gateway_method.projects_name_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "projects_name_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.projects_name.id
  http_method = aws_api_gateway_method.projects_name_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }

  response_models = {
    "application/json" = "Empty"
  }
}

resource "aws_api_gateway_integration_response" "projects_name_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.projects_name.id
  http_method = aws_api_gateway_method.projects_name_options.http_method
  status_code = aws_api_gateway_method_response.projects_name_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,PATCH,DELETE'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# -----------------------------------------------------------------------------
# Lambda Permissions for API Gateway (Edit and Delete)
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "apigw_invoke_edit" {
  statement_id  = "AllowAPIGatewayInvokeEdit"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.edit_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_invoke_delete" {
  statement_id  = "AllowAPIGatewayInvokeDelete"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# -----------------------------------------------------------------------------
# API Gateway Deployment and Stage
# -----------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "api_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  depends_on = [
    aws_api_gateway_integration.initiate_integration,
    aws_api_gateway_integration.finalize_integration,
    aws_api_gateway_integration.suggest_tags_integration,
    aws_api_gateway_integration.projects_name_patch_integration,
    aws_api_gateway_integration.projects_name_delete_integration
  ]

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.upload.id,
      aws_api_gateway_resource.upload_initiate.id,
      aws_api_gateway_resource.upload_finalize.id,
      aws_api_gateway_method.initiate_post.id,
      aws_api_gateway_integration.initiate_integration.id,
      aws_api_gateway_method.finalize_post.id,
      aws_api_gateway_integration.finalize_integration.id,
      aws_api_gateway_method.initiate_options.id,
      aws_api_gateway_integration.initiate_options_integration.id,
      aws_api_gateway_integration_response.initiate_options_integration_response.id,
      aws_api_gateway_method.finalize_options.id,
      aws_api_gateway_integration.finalize_options_integration.id,
      aws_api_gateway_integration_response.finalize_options_integration_response.id,
      aws_api_gateway_resource.tags.id,
      aws_api_gateway_resource.tags_suggest.id,
      aws_api_gateway_method.suggest_tags_post.id,
      aws_api_gateway_integration.suggest_tags_integration.id,
      aws_api_gateway_method.suggest_tags_options.id,
      aws_api_gateway_integration.suggest_tags_options_integration.id,
      aws_api_gateway_integration_response.suggest_tags_options_integration_response.id,
      aws_api_gateway_resource.projects.id,
      aws_api_gateway_resource.projects_name.id,
      aws_api_gateway_method.projects_name_patch.id,
      aws_api_gateway_integration.projects_name_patch_integration.id,
      aws_api_gateway_method.projects_name_delete.id,
      aws_api_gateway_integration.projects_name_delete_integration.id,
      aws_api_gateway_method.projects_name_options.id,
      aws_api_gateway_integration.projects_name_options_integration.id,
      aws_api_gateway_integration_response.projects_name_options_integration_response.id,
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
