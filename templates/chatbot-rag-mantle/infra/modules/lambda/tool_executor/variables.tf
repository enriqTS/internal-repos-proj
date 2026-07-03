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

variable "rag_bucket_arn" {
  description = "ARN of the S3 RAG documents bucket"
  type        = string
}

variable "rag_bucket_name" {
  description = "Name of the S3 RAG documents bucket"
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
