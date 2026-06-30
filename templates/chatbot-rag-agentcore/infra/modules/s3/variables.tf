variable "project_prefix" {
  description = "Prefix used to construct the S3 bucket name (e.g. myproject-rag-documents)"
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
