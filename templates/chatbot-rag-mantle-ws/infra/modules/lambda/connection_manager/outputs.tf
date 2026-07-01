output "function_name" {
  description = "Name of the Connection Manager Lambda function"
  value       = aws_lambda_function.connection_manager.function_name
}

output "function_arn" {
  description = "ARN of the Connection Manager Lambda function"
  value       = aws_lambda_function.connection_manager.arn
}

output "invoke_arn" {
  description = "Invoke ARN of the Connection Manager Lambda function"
  value       = aws_lambda_function.connection_manager.invoke_arn
}
