variable "project_name" {
  description = "Project name — used in resource naming. Lowercase alphanumeric and hyphens only, max 20 chars."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,19}$", var.project_name)) && var.project_name != ""
    error_message = "project_name must be 1-20 characters, lowercase alphanumeric and hyphens only."
  }
}

variable "environment" {
  description = "Deployment environment — determines resource naming suffix and tag value."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "client" {
  description = "Client name for cost allocation tags."
  type        = string

  validation {
    condition     = var.client != "" && length(var.client) <= 64
    error_message = "client must not be empty and must not exceed 64 characters."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "model_id" {
  description = "AI model identifier for Bedrock AgentCore (e.g., 'us.anthropic.claude-sonnet-4-20250514')"
  type        = string
  default     = "your-model-id"
}

variable "max_conversation_history" {
  description = "Maximum number of messages to retain in conversation context"
  type        = number
  default     = 50
}

variable "log_level" {
  description = "Powertools log level (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

################################################################################
# ECS-specific variables
################################################################################

variable "desired_count" {
  description = "ECS service desired task count"
  type        = number
  default     = 1
}

variable "cpu_units" {
  description = "ECS task CPU units"
  type        = number
  default     = 512
}

variable "memory_mib" {
  description = "ECS task memory in MiB"
  type        = number
  default     = 1024
}

variable "container_port" {
  description = "Container port for the application"
  type        = number
  default     = 8080
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

################################################################################
# Health check variables
################################################################################

variable "health_check_interval" {
  description = "ALB health check interval in seconds"
  type        = number
  default     = 30
}

variable "health_check_timeout" {
  description = "ALB health check timeout in seconds"
  type        = number
  default     = 5
}

variable "healthy_threshold" {
  description = "Number of consecutive successful health checks to be considered healthy"
  type        = number
  default     = 2
}

variable "unhealthy_threshold" {
  description = "Number of consecutive failed health checks to be considered unhealthy"
  type        = number
  default     = 3
}

variable "deregistration_delay" {
  description = "Target group deregistration delay in seconds"
  type        = number
  default     = 30
}
