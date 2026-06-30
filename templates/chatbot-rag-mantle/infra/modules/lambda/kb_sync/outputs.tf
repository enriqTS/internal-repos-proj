output "function_arn" {
  description = "ARN of the KB Sync Lambda function"
  value       = aws_lambda_function.kb_sync.arn
}

output "function_name" {
  description = "Name of the KB Sync Lambda function"
  value       = aws_lambda_function.kb_sync.function_name
}
