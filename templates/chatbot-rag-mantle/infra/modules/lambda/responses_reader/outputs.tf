output "function_arn" {
  description = "ARN of the responses reader Lambda function"
  value       = aws_lambda_function.responses_reader.arn
}

output "function_name" {
  description = "Name of the responses reader Lambda function"
  value       = aws_lambda_function.responses_reader.function_name
}

output "invoke_arn" {
  description = "Invoke ARN of the responses reader Lambda (for API Gateway integration)"
  value       = aws_lambda_function.responses_reader.invoke_arn
}
