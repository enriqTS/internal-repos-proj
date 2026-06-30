variable "project_prefix" {
  description = "Prefix used for naming all resources"
  type        = string
}

variable "aws_region" {
  description = "AWS region for the deployment"
  type        = string
}

variable "rag_bucket_arn" {
  description = "ARN of the S3 RAG documents bucket"
  type        = string
}

variable "opensearch_collection_arn" {
  description = "ARN of the OpenSearch Serverless collection for vector storage"
  type        = string
}
