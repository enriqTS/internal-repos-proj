resource "aws_dynamodb_table" "responses" {
  name         = "${var.project_prefix}-responses"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "messageId"

  attribute {
    name = "messageId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Name    = "${var.project_prefix}-responses"
    Project = var.project_prefix
  }
}
