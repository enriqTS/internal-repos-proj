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

variable "agent_id" {
  description = "ID of the Bedrock AgentCore agent"
  type        = string
}

variable "agent_alias_id" {
  description = "Alias ID of the Bedrock AgentCore agent"
  type        = string
}

variable "agent_arn" {
  description = "ARN of the Bedrock AgentCore agent (for IAM permissions)"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
