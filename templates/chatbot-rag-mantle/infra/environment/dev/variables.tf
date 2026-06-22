variable "project_prefix" {
  description = "Prefix for all resource names (e.g., my-chatbot-dev)"
  type        = string
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
  description = "AI model identifier for Bedrock Mantle"
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
