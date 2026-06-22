output "rest_api_id" {
  description = "ID of the REST API"
  value       = aws_api_gateway_rest_api.chatbot.id
}

output "rest_api_execution_arn" {
  description = "Execution ARN of the REST API"
  value       = aws_api_gateway_rest_api.chatbot.execution_arn
}

output "stage_invoke_url" {
  description = "Invoke URL for the deployed stage"
  value       = aws_api_gateway_stage.chatbot.invoke_url
}

output "api_gateway_role_arn" {
  description = "ARN of the IAM role used by API Gateway"
  value       = aws_iam_role.api_gateway.arn
}
