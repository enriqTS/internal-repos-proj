variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "tool_executor_arn" {
  description = "ARN of the Tool Executor Lambda function to register as an action group"
  type        = string
}

variable "model_id" {
  description = "Foundation model ID for the Bedrock agent (e.g., anthropic.claude-3-sonnet-20240229-v1:0)"
  type        = string
}

variable "agent_instruction" {
  description = "System prompt / instruction for the Bedrock agent"
  type        = string
  default     = "You are a helpful assistant. Replace this prompt with your own instructions."
}
