variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "bucket_name_prefix" {
  description = "Prefix for the S3 bucket name (will be combined with a unique suffix)"
  type        = string
  default     = "internal-repos"
}

variable "domain_name" {
  description = "Custom domain name for the CloudFront distribution"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for HTTPS on the custom domain"
  type        = string
  default     = ""
}

variable "openai_api_key" {
  description = "API key for Bedrock Mantle OpenAI-compatible endpoint"
  type        = string
  sensitive   = true
}

variable "openai_project_id" {
  description = "Project ID for Bedrock Mantle (default: 'default')"
  type        = string
  default     = "default"
}

