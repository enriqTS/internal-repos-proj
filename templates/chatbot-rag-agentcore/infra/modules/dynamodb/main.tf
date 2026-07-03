locals {
  table_name = "${var.project_name}-${var.environment}-user-context"
}

resource "aws_dynamodb_table" "user_context" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }
}
