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

variable "connections_table_name" {
  description = "Name of the DynamoDB connections table"
  type        = string
}

variable "connections_table_arn" {
  description = "ARN of the DynamoDB connections table"
  type        = string
}

variable "connection_ttl_seconds" {
  description = "TTL in seconds for connection entries (default: 86400 = 24h)"
  type        = string
  default     = "86400"
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
