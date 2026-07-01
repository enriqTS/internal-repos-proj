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
  description = "Bedrock Mantle API base URL (OpenAI-compatible endpoint)"
  type        = string
}

variable "model_id" {
  description = "Bedrock model identifier for the Mantle API"
  type        = string
}

variable "aws_region" {
  description = "AWS region for Bedrock endpoint ARN construction"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID for IAM resource ARN construction"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
