variable "project_prefix" {
  description = "Prefix for resource naming (e.g., myproject-dev)"
  type        = string
}

variable "openapi_spec" {
  description = "OpenAPI 3.0 specification JSON content for the REST API"
  type        = string
}

variable "stage_name" {
  description = "API Gateway deployment stage name"
  type        = string
  default     = "v1"
}

variable "aws_region" {
  description = "AWS region for the API Gateway"
  type        = string
}

variable "sqs_queue_url" {
  description = "URL of the SQS FIFO queue for message routing"
  type        = string
}

variable "sqs_queue_arn" {
  description = "ARN of the SQS FIFO queue for IAM policy"
  type        = string
}
