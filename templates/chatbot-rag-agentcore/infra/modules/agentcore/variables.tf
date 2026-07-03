variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
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

variable "knowledge_base_id" {
  description = "ID of the Bedrock Knowledge Base to associate with the agent for native RAG retrieval"
  type        = string
}
