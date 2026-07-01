variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for CloudWatch Logs configuration"
  type        = string
}

variable "desired_count" {
  description = "ECS service desired task count"
  type        = number
  default     = 1
}

variable "cpu_units" {
  description = "ECS task CPU units"
  type        = number
  default     = 512
}

variable "memory_mib" {
  description = "ECS task memory in MiB"
  type        = number
  default     = 1024
}

variable "container_port" {
  description = "Container port for the application"
  type        = number
  default     = 8080
}

variable "log_level" {
  description = "Powertools log level (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

variable "max_conversation_history" {
  description = "Maximum messages retained in conversation context"
  type        = number
  default     = 50
}

variable "max_tool_iterations" {
  description = "Maximum tool-use loop iterations (Mantle variant)"
  type        = number
  default     = 10
}

variable "mantle_base_url" {
  description = "Bedrock Mantle API base URL (OpenAI-compatible endpoint)"
  type        = string
}

variable "model_id" {
  description = "Bedrock model identifier for Mantle API"
  type        = string
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository for the container image"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ARN of the ECR repository for IAM permissions"
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB user context table"
  type        = string
}

variable "dynamodb_table_arn" {
  description = "ARN of the DynamoDB user context table"
  type        = string
}

variable "connection_table_name" {
  description = "Name of the DynamoDB connections table"
  type        = string
}

variable "connection_table_arn" {
  description = "ARN of the DynamoDB connections table"
  type        = string
}

variable "rag_bucket_name" {
  description = "Name of the S3 RAG documents bucket"
  type        = string
}

variable "rag_bucket_arn" {
  description = "ARN of the S3 RAG documents bucket"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets for ECS tasks"
  type        = list(string)
}

variable "target_group_arn" {
  description = "ARN of the NLB target group"
  type        = string
}

variable "nlb_security_group_id" {
  description = "Security group ID of the NLB (for ingress rules)"
  type        = string
}

variable "websocket_api_endpoint" {
  description = "WebSocket API Management endpoint for @connections"
  type        = string
}

variable "websocket_api_arn" {
  description = "ARN of the WebSocket API (for execute-api:ManageConnections permission)"
  type        = string
}
