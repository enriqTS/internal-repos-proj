variable "project_prefix" {
  description = "Prefix for all resource names"
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

variable "dynamodb_table_arn" {
  description = "ARN of the DynamoDB user context table"
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB user context table"
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

variable "max_conversation_history" {
  description = "Maximum number of messages to retain in conversation history"
  type        = string
  default     = "50"
}

variable "max_retry_attempts" {
  description = "Maximum number of retry attempts for failed operations"
  type        = string
  default     = "3"
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
