output "api_id" {
  description = "ID of the WebSocket API"
  value       = aws_apigatewayv2_api.websocket.id
}

output "api_endpoint" {
  description = "WebSocket API endpoint URL"
  value       = aws_apigatewayv2_api.websocket.api_endpoint
}

output "stage_invoke_url" {
  description = "Full invoke URL for the WebSocket stage (wss://...)"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "execution_arn" {
  description = "Execution ARN of the WebSocket API (for IAM permissions)"
  value       = aws_apigatewayv2_api.websocket.execution_arn
}

output "stage_arn" {
  description = "ARN of the WebSocket API stage (for execute-api:ManageConnections)"
  value       = "arn:aws:execute-api:${var.aws_region}:*:${aws_apigatewayv2_api.websocket.id}/${var.environment}/*"
}
