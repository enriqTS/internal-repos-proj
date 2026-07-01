variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
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
