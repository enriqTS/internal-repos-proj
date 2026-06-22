variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "shared_layer_arn" {
  description = "ARN of the shared Lambda layer"
  type        = string
}

variable "agent_id" {
  description = "Bedrock AgentCore agent ID"
  type        = string
}

variable "agent_alias_id" {
  description = "Bedrock AgentCore agent alias ID"
  type        = string
}

variable "log_level" {
  description = "Log level for aws-lambda-powertools"
  type        = string
  default     = "INFO"
}
