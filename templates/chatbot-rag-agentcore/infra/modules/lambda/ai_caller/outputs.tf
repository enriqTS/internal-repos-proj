output "function_name" {
  description = "Name of the AI Caller Lambda function"
  value       = aws_lambda_function.ai_caller.function_name
}

output "function_arn" {
  description = "ARN of the AI Caller Lambda function"
  value       = aws_lambda_function.ai_caller.arn
}

output "role_arn" {
  description = "ARN of the AI Caller IAM role"
  value       = aws_iam_role.ai_caller.arn
}
