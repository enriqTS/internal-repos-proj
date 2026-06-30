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

variable "throttle_rate_limit" {
  description = "API Gateway throttle rate limit (requests/second)"
  type        = number
  default     = 100
}

variable "throttle_burst_limit" {
  description = "API Gateway throttle burst limit"
  type        = number
  default     = 200
}

variable "quota_limit" {
  description = "Daily API quota limit per API key"
  type        = number
  default     = 10000
}

variable "cache_enabled" {
  description = "Enable API Gateway cache cluster"
  type        = bool
  default     = false
}

variable "cache_size" {
  description = "API Gateway cache cluster size"
  type        = string
  default     = "0.5"
}

variable "responses_reader_invoke_arn" {
  description = "Invoke ARN of the responses reader Lambda"
  type        = string
  default     = ""
}

variable "responses_reader_function_name" {
  description = "Name of the responses reader Lambda function"
  type        = string
  default     = ""
}
