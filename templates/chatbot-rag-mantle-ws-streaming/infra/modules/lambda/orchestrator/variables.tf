variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "shared_layer_arn" {
  description = "ARN of the shared Lambda layer"
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN of the SQS FIFO queue to consume messages from"
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

variable "connections_table_name" {
  description = "Name of the DynamoDB connections table"
  type        = string
}

variable "connections_table_arn" {
  description = "ARN of the DynamoDB connections table"
  type        = string
}

variable "ai_caller_arn" {
  description = "ARN of the AI Caller Lambda function"
  type        = string
}

variable "ai_caller_function_name" {
  description = "Name of the AI Caller Lambda function"
  type        = string
}

variable "websocket_api_endpoint" {
  description = "WebSocket API endpoint URL for @connections POST (https://...)"
  type        = string
}

variable "websocket_api_stage_arn" {
  description = "ARN pattern for execute-api:ManageConnections permission"
  type        = string
}

variable "max_conversation_history" {
  description = "Maximum number of messages to retain in conversation history"
  type        = string
  default     = "50"
}

variable "max_tool_iterations" {
  description = "Maximum tool-use loop iterations (Mantle streaming)"
  type        = string
  default     = "10"
}

variable "max_chunk_size" {
  description = "Maximum tokens per WebSocket frame (streaming variant)"
  type        = string
  default     = "1"
}

variable "rag_bucket_name" {
  description = "Name of the S3 RAG documents bucket"
  type        = string
}

variable "rag_bucket_arn" {
  description = "ARN of the S3 RAG documents bucket"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
