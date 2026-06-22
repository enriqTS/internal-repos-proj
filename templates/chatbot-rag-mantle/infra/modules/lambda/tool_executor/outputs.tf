output "function_name" {
  description = "Name of the Tool Executor Lambda function"
  value       = aws_lambda_function.tool_executor.function_name
}

output "function_arn" {
  description = "ARN of the Tool Executor Lambda function"
  value       = aws_lambda_function.tool_executor.arn
}

output "role_arn" {
  description = "ARN of the Tool Executor IAM role"
  value       = aws_iam_role.tool_executor.arn
}
