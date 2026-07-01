################################################################################
# API Gateway WebSocket API — ECS WebSocket Variants
#
# Routes $connect, $disconnect, and sendMessage to the ECS service via
# VPC Link -> NLB. The ECS service handles the events as HTTP POST endpoints.
################################################################################

resource "aws_apigatewayv2_api" "websocket" {
  name                       = "${var.project_name}-${var.environment}-ws-api"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"

  tags = {
    Name = "${var.project_name}-${var.environment}-ws-api"
  }
}

################################################################################
# VPC Link — connects API Gateway to the internal NLB
################################################################################

resource "aws_apigatewayv2_vpc_link" "main" {
  name               = "${var.project_name}-${var.environment}-vpc-link"
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [var.vpc_link_security_group_id]

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc-link"
  }
}

################################################################################
# Integrations — HTTP_PROXY via VPC Link to NLB -> ECS
################################################################################

resource "aws_apigatewayv2_integration" "connect" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "HTTP_PROXY"
  integration_uri    = var.nlb_listener_arn
  integration_method = "POST"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.main.id

  request_parameters = {
    "integration.request.header.connectionId" = "context.connectionId"
  }
}

resource "aws_apigatewayv2_integration" "disconnect" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "HTTP_PROXY"
  integration_uri    = var.nlb_listener_arn
  integration_method = "POST"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.main.id

  request_parameters = {
    "integration.request.header.connectionId" = "context.connectionId"
  }
}

resource "aws_apigatewayv2_integration" "send_message" {
  api_id             = aws_apigatewayv2_api.websocket.id
  integration_type   = "HTTP_PROXY"
  integration_uri    = var.nlb_listener_arn
  integration_method = "POST"
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.main.id

  request_parameters = {
    "integration.request.header.connectionId" = "context.connectionId"
  }
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
# Stage (auto-deploy)
################################################################################

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.websocket.id
  name        = var.environment
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 500
    throttling_rate_limit  = 1000
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-ws-stage"
  }
}
