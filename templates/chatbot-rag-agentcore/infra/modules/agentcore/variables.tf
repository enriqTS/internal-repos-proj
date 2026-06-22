variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "tool_executor_arn" {
  description = "ARN of the Tool Executor Lambda function for the action group"
  type        = string
}

variable "model_id" {
  description = "Foundation model ID for the Bedrock agent"
  type        = string
}

variable "agent_instruction" {
  description = "System instruction for the Bedrock agent"
  type        = string
  default     = "You are a helpful assistant."
}
