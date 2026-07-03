################################################################################
# User Context Table
################################################################################

resource "aws_dynamodb_table" "user_context" {
  name         = "${var.project_name}-${var.environment}-user-context"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-user-context"
  }
}

################################################################################
# Connection Table (WebSocket connection tracking with TTL)
################################################################################

resource "aws_dynamodb_table" "connections" {
  name         = "${var.project_name}-${var.environment}-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  # TTL for automatic stale connection cleanup (24h)
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # GSI for looking up connection by userId
  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-connections"
  }
}
