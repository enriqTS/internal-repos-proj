output "api_id" {
  description = "ID of the WebSocket API"
  value       = aws_apigatewayv2_api.websocket.id
}

output "api_endpoint" {
  description = "WebSocket API endpoint URL (wss://)"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "api_management_endpoint" {
  description = "API Gateway Management API endpoint for @connections POST"
  value       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
}

output "stage_arn" {
  description = "ARN of the WebSocket API stage (for IAM ManageConnections permission)"
  value       = aws_apigatewayv2_stage.main.arn
}

output "execution_arn" {
  description = "Execution ARN of the WebSocket API"
  value       = aws_apigatewayv2_api.websocket.execution_arn
}
