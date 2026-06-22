output "api_gateway_invoke_url" {
  description = "Invoke URL for the API Gateway stage"
  value       = module.api_gateway.stage_invoke_url
}

output "api_gateway_rest_api_id" {
  description = "ID of the REST API"
  value       = module.api_gateway.rest_api_id
}

output "sqs_queue_url" {
  description = "URL of the SQS FIFO message queue"
  value       = module.sqs.queue_url
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB user context table"
  value       = module.dynamodb.table_name
}

output "s3_rag_bucket_name" {
  description = "Name of the S3 RAG documents bucket"
  value       = module.s3.bucket_name
}

output "agentcore_agent_id" {
  description = "ID of the Bedrock AgentCore agent"
  value       = module.agentcore.agent_id
}

output "agentcore_agent_alias_id" {
  description = "Alias ID of the Bedrock AgentCore agent"
  value       = module.agentcore.agent_alias_id
}
