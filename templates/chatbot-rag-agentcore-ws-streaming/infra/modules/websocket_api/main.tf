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

# sendMessage → Orchestrator Lambda
resource "aws_apigatewayv2_integration" "send_message" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "AWS_PROXY"
  integration_uri    = var.orchestrator_invoke_arn
  integration_method = "POST"
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

resource "aws_lambda_permission" "apigw_send_message" {
  statement_id  = "AllowAPIGatewaySendMessage"
  action        = "lambda:InvokeFunction"
  function_name = var.orchestrator_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/sendMessage"
}
