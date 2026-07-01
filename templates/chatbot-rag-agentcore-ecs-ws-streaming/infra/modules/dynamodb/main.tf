################################################################################
# DynamoDB — User Context Table
################################################################################

resource "aws_dynamodb_table" "user_context" {
  name         = "${var.project_name}-${var.environment}-user-context"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-user-context"
  }
}

################################################################################
# DynamoDB — Connection Table (WebSocket variant)
#
# Stores active WebSocket connectionId -> userId mappings.
# TTL on expiresAt provides automatic cleanup of stale connections (24h).
# GSI on userId enables reverse lookup (find connection for a user).
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

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-connections"
  }
}
