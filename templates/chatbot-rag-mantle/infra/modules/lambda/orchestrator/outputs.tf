output "function_name" {
  description = "Name of the Orchestrator Lambda function"
  value       = aws_lambda_function.orchestrator.function_name
}

output "function_arn" {
  description = "ARN of the Orchestrator Lambda function"
  value       = aws_lambda_function.orchestrator.arn
}

output "role_arn" {
  description = "ARN of the Orchestrator IAM role"
  value       = aws_iam_role.orchestrator.arn
}
