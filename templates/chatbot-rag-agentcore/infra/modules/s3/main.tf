################################################################################
# S3 Bucket — RAG Documents
################################################################################

locals {
  bucket_name = "${var.project_name}-${var.environment}-rag-documents"
}

resource "aws_s3_bucket" "rag_documents" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_versioning" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "rag_documents" {
  bucket = aws_s3_bucket.rag_documents.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

################################################################################
# S3 Event Notification — trigger KB Sync Lambda on document changes
################################################################################

resource "aws_s3_bucket_notification" "rag_documents" {
  count  = var.kb_sync_lambda_arn != "" ? 1 : 0
  bucket = aws_s3_bucket.rag_documents.id

  lambda_function {
    lambda_function_arn = var.kb_sync_lambda_arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
  }
}

resource "aws_lambda_permission" "s3_invoke_kb_sync" {
  count         = var.kb_sync_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowS3InvokeKBSync"
  action        = "lambda:InvokeFunction"
  function_name = var.kb_sync_lambda_function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.rag_documents.arn
}
