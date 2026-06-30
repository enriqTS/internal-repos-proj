variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "shared_layer_arn" {
  description = "ARN of the shared Lambda layer"
  type        = string
}

variable "responses_table_arn" {
  description = "ARN of the responses DynamoDB table"
  type        = string
}

variable "responses_table_name" {
  description = "Name of the responses DynamoDB table"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
