locals {
  table_name = "${var.project_name}-${var.environment}-responses"
}

resource "aws_dynamodb_table" "responses" {
  name         = local.table_name
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

  server_side_encryption {
    enabled = true
  }
}
