output "table_name" {
  description = "Name of the DynamoDB user context table"
  value       = aws_dynamodb_table.user_context.name
}

output "table_arn" {
  description = "ARN of the DynamoDB user context table"
  value       = aws_dynamodb_table.user_context.arn
}
