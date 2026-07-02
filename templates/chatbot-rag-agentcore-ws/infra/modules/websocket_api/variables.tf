variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for API Gateway ARN construction"
  type        = string
}

variable "connection_manager_invoke_arn" {
  description = "Invoke ARN of the Connection Manager Lambda function"
  type        = string
}

variable "connection_manager_function_name" {
  description = "Name of the Connection Manager Lambda function"
  type        = string
}
