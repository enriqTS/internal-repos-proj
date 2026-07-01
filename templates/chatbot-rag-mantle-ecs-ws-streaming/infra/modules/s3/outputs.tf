output "bucket_name" {
  description = "S3 RAG bucket name"
  value       = aws_s3_bucket.rag.id
}

output "bucket_arn" {
  description = "S3 RAG bucket ARN"
  value       = aws_s3_bucket.rag.arn
}
