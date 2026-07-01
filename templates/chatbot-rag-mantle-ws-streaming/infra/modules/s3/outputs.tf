output "bucket_name" {
  description = "Name of the RAG documents S3 bucket"
  value       = aws_s3_bucket.rag_documents.id
}

output "bucket_arn" {
  description = "ARN of the RAG documents S3 bucket"
  value       = aws_s3_bucket.rag_documents.arn
}
