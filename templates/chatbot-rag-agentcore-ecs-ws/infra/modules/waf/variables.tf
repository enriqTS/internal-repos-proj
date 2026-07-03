variable "project_name" {
  description = "Project name prefix for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment for resource naming"
  type        = string
}

variable "alb_arn" {
  description = "ARN of the ALB to associate the WAF WebACL with"
  type        = string
}

variable "api_key_value" {
  description = "The API key value to validate against (from SSM/Secrets Manager)"
  type        = string
  sensitive   = true
}

variable "waf_enabled" {
  description = "Toggle to enable/disable WAF WebACL"
  type        = bool
  default     = true
}
