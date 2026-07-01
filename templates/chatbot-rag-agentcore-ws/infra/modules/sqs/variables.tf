variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "max_receive_count" {
  description = "Number of times a message can be received before being sent to the DLQ"
  type        = number
  default     = 3
}
