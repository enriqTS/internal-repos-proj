variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "tool_executor_arn" {
  description = "ARN of the Tool Executor Lambda function to register as an action group"
  type        = string
}

variable "model_id" {
  description = "Foundation model ID for the Bedrock agent (e.g., us.anthropic.claude-sonnet-4-20250514)"
  type        = string
}

variable "agent_instruction" {
  description = "System prompt / instruction for the Bedrock agent"
  type        = string
  default     = "You are a helpful assistant. Replace this prompt with your own instructions."
}
