resource "aws_dynamodb_table" "user_context" {
  name         = "${var.project_prefix}-user-context"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = {
    Name    = "${var.project_prefix}-user-context"
    Project = var.project_prefix
  }
}
