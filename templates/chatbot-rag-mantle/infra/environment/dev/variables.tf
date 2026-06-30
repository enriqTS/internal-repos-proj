variable "project_name" {
  description = "Project name — used in resource naming. Lowercase alphanumeric and hyphens only, max 20 chars."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,19}$", var.project_name)) && var.project_name != ""
    error_message = "project_name must be 1–20 characters, lowercase alphanumeric and hyphens only."
  }
}

variable "environment" {
  description = "Deployment environment — determines resource naming suffix and tag value."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "client" {
  description = "Client name for cost allocation tags."
  type        = string

  validation {
    condition     = var.client != "" && length(var.client) <= 64
    error_message = "client must not be empty and must not exceed 64 characters."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID for ARN construction"
  type        = string
}

variable "model_id" {
  description = "AI model identifier for Bedrock (e.g., 'us.anthropic.claude-sonnet-4-20250514')"
  type        = string
  default     = "your-model-id"
}

variable "mantle_base_url" {
  description = "Bedrock Mantle API base URL"
  type        = string
  default     = "https://bedrock-mantle.us-east-1.api.aws/v1"
}

variable "max_conversation_history" {
  description = "Maximum number of messages to retain in conversation context"
  type        = number
  default     = 50
}

variable "max_retry_attempts" {
  description = "Maximum retry attempts for message processing"
  type        = number
  default     = 3
}

variable "log_level" {
  description = "Powertools log level (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

variable "opensearch_collection_arn" {
  description = "ARN of the OpenSearch Serverless collection for the Bedrock Knowledge Base"
  type        = string
}
