variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "aws_region" {
  description = "AWS region for the WebSocket API"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the VPC Link"
  type        = list(string)
}

variable "vpc_link_security_group_id" {
  description = "Security group ID for the VPC Link"
  type        = string
}

variable "nlb_listener_arn" {
  description = "ARN of the NLB listener for VPC Link integration target"
  type        = string
}
