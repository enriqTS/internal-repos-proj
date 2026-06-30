variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "shared_layer_arn" {
  description = "ARN of the shared Lambda layer"
  type        = string
}

variable "knowledge_base_id" {
  description = "Bedrock Knowledge Base ID"
  type        = string
}

variable "data_source_id" {
  description = "Bedrock Knowledge Base Data Source ID"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
