output "api_id" {
  description = "API Gateway WebSocket API ID"
  value       = aws_apigatewayv2_api.websocket.id
}

output "api_arn" {
  description = "ARN of the WebSocket API (for IAM permissions)"
  value       = aws_apigatewayv2_api.websocket.arn
}

output "api_endpoint" {
  description = "API Gateway Management API endpoint for @connections"
  value       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
}

output "websocket_url" {
  description = "WebSocket connection URL (wss://...)"
  value       = "wss://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
}

output "stage_name" {
  description = "Name of the deployed stage"
  value       = aws_apigatewayv2_stage.main.name
}
