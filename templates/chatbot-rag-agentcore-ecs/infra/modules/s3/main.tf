resource "aws_s3_bucket" "rag" {
  bucket = "${var.project_name}-${var.environment}-rag-documents"

  tags = {
    Name = "${var.project_name}-${var.environment}-rag-documents"
  }
}

resource "aws_s3_bucket_versioning" "rag" {
  bucket = aws_s3_bucket.rag.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "rag" {
  bucket = aws_s3_bucket.rag.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "rag" {
  bucket = aws_s3_bucket.rag.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

################################################################################
# S3 Event Notification — trigger KB Sync Lambda on document changes
################################################################################

resource "aws_s3_bucket_notification" "rag" {
  count  = var.kb_sync_lambda_arn != "" ? 1 : 0
  bucket = aws_s3_bucket.rag.id

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
  source_arn    = aws_s3_bucket.rag.arn
}
