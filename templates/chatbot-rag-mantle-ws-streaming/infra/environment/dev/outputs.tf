output "websocket_api_endpoint" {
  description = "WebSocket API endpoint URL (wss://...)"
  value       = module.websocket_api.stage_invoke_url
}

output "websocket_api_id" {
  description = "ID of the WebSocket API"
  value       = module.websocket_api.api_id
}

output "sqs_queue_url" {
  description = "URL of the SQS FIFO message queue"
  value       = module.sqs.queue_url
}

output "user_context_table_name" {
  description = "Name of the DynamoDB user context table"
  value       = module.dynamodb.user_context_table_name
}

output "connections_table_name" {
  description = "Name of the DynamoDB connections table"
  value       = module.dynamodb.connections_table_name
}

output "s3_rag_bucket_name" {
  description = "Name of the S3 RAG documents bucket"
  value       = module.s3.bucket_name
}
