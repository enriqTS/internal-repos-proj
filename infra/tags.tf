# =============================================================================
# API Gateway + Lambda infrastructure for the /tags/suggest endpoint
# =============================================================================

# -----------------------------------------------------------------------------
# IAM Policy for Bedrock InvokeModel (attached to existing lambda_role)
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_tags_s3_policy" {
  name = "${var.bucket_name_prefix}-lambda-tags-s3-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.frontend.arn}/tags.json"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Lambda Function - Tag Suggestion
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "suggest_tags_lambda" {
  function_name = "${var.bucket_name_prefix}-suggest-tags"
  role          = aws_iam_role.lambda_role.arn
  handler       = "suggest-tags.handler"
  runtime       = "nodejs22.x"
  memory_size   = 512
  timeout       = 30

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME            = aws_s3_bucket.frontend.id
      ANTHROPIC_API_KEY      = var.anthropic_api_key
      ANTHROPIC_WORKSPACE_ID = var.anthropic_workspace_id
    }
  }

  tags = {
    Name    = "${var.bucket_name_prefix}-suggest-tags-lambda"
    Project = "internal-repos"
  }
}

# -----------------------------------------------------------------------------
# API Gateway Resources: /tags and /tags/suggest
# -----------------------------------------------------------------------------

resource "aws_api_gateway_resource" "tags" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "tags"
}

resource "aws_api_gateway_resource" "tags_suggest" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.tags.id
  path_part   = "suggest"
}

# -----------------------------------------------------------------------------
# POST /tags/suggest → Suggest Tags Lambda
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "suggest_tags_post" {
  rest_api_id      = aws_api_gateway_rest_api.api.id
  resource_id      = aws_api_gateway_resource.tags_suggest.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "suggest_tags_integration" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.tags_suggest.id
  http_method             = aws_api_gateway_method.suggest_tags_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.suggest_tags_lambda.invoke_arn
}

# -----------------------------------------------------------------------------
# CORS: OPTIONS on /tags/suggest
# -----------------------------------------------------------------------------

resource "aws_api_gateway_method" "suggest_tags_options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.tags_suggest.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "suggest_tags_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.tags_suggest.id
  http_method = aws_api_gateway_method.suggest_tags_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "suggest_tags_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.tags_suggest.id
  http_method = aws_api_gateway_method.suggest_tags_options.http_method
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

resource "aws_api_gateway_integration_response" "suggest_tags_options_integration_response" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.tags_suggest.id
  http_method = aws_api_gateway_method.suggest_tags_options.http_method
  status_code = aws_api_gateway_method_response.suggest_tags_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# -----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "apigw_invoke_suggest_tags" {
  statement_id  = "AllowAPIGatewayInvokeSuggestTags"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.suggest_tags_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}
