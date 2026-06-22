variable "project_prefix" {
  description = "Prefix for all resource names"
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
