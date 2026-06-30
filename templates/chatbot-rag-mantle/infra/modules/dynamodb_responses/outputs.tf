output "table_name" {
  description = "Name of the responses DynamoDB table"
  value       = aws_dynamodb_table.responses.name
}

output "table_arn" {
  description = "ARN of the responses DynamoDB table"
  value       = aws_dynamodb_table.responses.arn
}
