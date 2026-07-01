variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "nlb_arn" {
  description = "ARN of the Network Load Balancer for VPC Link"
  type        = string
}

variable "nlb_dns_name" {
  description = "DNS name of the NLB for integration URI"
  type        = string
}

variable "vpc_link_subnet_ids" {
  description = "Subnet IDs for the VPC Link"
  type        = list(string)
}
