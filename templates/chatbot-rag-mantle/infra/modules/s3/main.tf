################################################################################
# S3 Bucket — RAG Documents
################################################################################

resource "aws_s3_bucket" "rag_documents" {
  bucket = "${var.project_prefix}-rag-documents"

  tags = {
    Name = "${var.project_prefix}-rag-documents"
  }
}

resource "aws_s3_bucket_versioning" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
