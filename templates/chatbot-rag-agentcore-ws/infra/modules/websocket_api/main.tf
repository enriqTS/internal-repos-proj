################################################################################
# API Gateway v2 — WebSocket API
################################################################################

locals {
  api_name = "${var.project_name}-${var.environment}-ws-api"
}

resource "aws_apigatewayv2_api" "websocket" {
  name                       = local.api_name
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

################################################################################
# Routes
################################################################################

resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.connect.id}"
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.disconnect.id}"
}

resource "aws_apigatewayv2_route" "send_message" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "sendMessage"
  target    = "integrations/${aws_apigatewayv2_integration.send_message.id}"
}

################################################################################
# Integrations
################################################################################

# $connect → Connection Manager Lambda
resource "aws_apigatewayv2_integration" "connect" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "AWS_PROXY"
  integration_uri    = var.connection_manager_invoke_arn
  integration_method = "POST"
}

# $disconnect → Connection Manager Lambda
resource "aws_apigatewayv2_integration" "disconnect" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "AWS_PROXY"
  integration_uri    = var.connection_manager_invoke_arn
  integration_method = "POST"
}

# sendMessage → SQS FIFO via AWS service integration
resource "aws_apigatewayv2_integration" "send_message" {
  api_id                = aws_apigatewayv2_api.websocket.id
  integration_type      = "AWS"
  integration_uri       = "arn:aws:apigateway:${var.aws_region}:sqs:action/SendMessage"
  integration_method    = "POST"
  credentials_arn       = aws_iam_role.apigw_sqs.arn
  passthrough_behavior  = "NEVER"
  template_selection_expression = "\\$default"

  request_templates = {
    "$default" = "Action=SendMessage&MessageGroupId=$input.path('$.userId')&MessageBody=$util.urlEncode($input.body)&QueueUrl=$util.urlEncode('${var.sqs_queue_url}')"
  }
}

# Route response for sendMessage (required for non-proxy integrations)
resource "aws_apigatewayv2_route_response" "send_message" {
  api_id             = aws_apigatewayv2_api.websocket.id
  route_id           = aws_apigatewayv2_route.send_message.id
  route_response_key = "$default"
}

resource "aws_apigatewayv2_integration_response" "send_message" {
  api_id                   = aws_apigatewayv2_api.websocket.id
  integration_id           = aws_apigatewayv2_integration.send_message.id
  integration_response_key = "$default"
}

################################################################################
# Stage
################################################################################

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.websocket.id
  name        = var.environment
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

################################################################################
# Lambda Permissions — allow API Gateway to invoke Connection Manager
################################################################################

resource "aws_lambda_permission" "apigw_connect" {
  statement_id  = "AllowAPIGatewayConnect"
  action        = "lambda:InvokeFunction"
  function_name = var.connection_manager_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/$connect"
}

resource "aws_lambda_permission" "apigw_disconnect" {
  statement_id  = "AllowAPIGatewayDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = var.connection_manager_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/$disconnect"
}

################################################################################
# IAM Role — API Gateway → SQS
################################################################################

data "aws_iam_policy_document" "apigw_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apigw_sqs" {
  name               = "${var.project_name}-${var.environment}-apigw-sqs-role"
  assume_role_policy = data.aws_iam_policy_document.apigw_assume.json
}

resource "aws_iam_role_policy" "apigw_sqs" {
  name   = "${var.project_name}-${var.environment}-apigw-sqs-policy"
  role   = aws_iam_role.apigw_sqs.id
  policy = data.aws_iam_policy_document.apigw_sqs_policy.json
}

data "aws_iam_policy_document" "apigw_sqs_policy" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [var.sqs_queue_arn]
  }
}
