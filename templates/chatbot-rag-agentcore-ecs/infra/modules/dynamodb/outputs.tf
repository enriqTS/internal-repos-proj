output "table_name" {
  description = "DynamoDB user context table name"
  value       = aws_dynamodb_table.user_context.name
}

output "table_arn" {
  description = "DynamoDB user context table ARN"
  value       = aws_dynamodb_table.user_context.arn
}
