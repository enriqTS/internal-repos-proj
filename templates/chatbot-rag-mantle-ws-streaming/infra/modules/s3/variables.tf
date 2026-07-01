variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "kb_sync_lambda_arn" {
  description = "ARN of the KB Sync Lambda function"
  type        = string
  default     = ""
}

variable "kb_sync_lambda_function_name" {
  description = "Name of the KB Sync Lambda function"
  type        = string
  default     = ""
}
