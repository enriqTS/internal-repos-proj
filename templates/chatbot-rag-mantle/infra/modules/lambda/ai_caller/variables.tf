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

variable "mantle_base_url" {
  description = "Base URL for the Bedrock Mantle API"
  type        = string
  default     = "https://bedrock-mantle.us-east-1.api.aws/v1"
}

variable "model_id" {
  description = "Model ID for the foundation model to use"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}

variable "memory_size" {
  description = "Amount of memory in MB allocated to the Lambda function"
  type        = number
  default     = 256
}
