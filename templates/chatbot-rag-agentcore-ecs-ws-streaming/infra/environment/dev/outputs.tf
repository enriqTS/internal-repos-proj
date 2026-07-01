output "websocket_api_endpoint" {
  description = "WebSocket API endpoint URL (connect with wss://)"
  value       = module.websocket_api.api_endpoint
}

output "websocket_api_management_endpoint" {
  description = "API Gateway Management API endpoint for @connections"
  value       = module.websocket_api.api_management_endpoint
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = module.ecs.service_name
}

output "ecr_repository_url" {
  description = "URL of the ECR repository (use for docker push)"
  value       = module.ecr.repository_url
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

output "agentcore_agent_id" {
  description = "ID of the Bedrock AgentCore agent"
  value       = module.agentcore.agent_id
}

output "agentcore_agent_alias_id" {
  description = "Alias ID of the Bedrock AgentCore agent"
  value       = module.agentcore.agent_alias_id
}

output "cloudwatch_log_group" {
  description = "Name of the CloudWatch log group for ECS tasks"
  value       = module.ecs.log_group_name
}
