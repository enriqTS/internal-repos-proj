################################################################################
# DynamoDB — User Context Table
################################################################################

locals {
  user_context_table_name = "${var.project_name}-${var.environment}-user-context"
  connections_table_name  = "${var.project_name}-${var.environment}-connections"
}

resource "aws_dynamodb_table" "user_context" {
  name         = local.user_context_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }
}

################################################################################
# DynamoDB — Connection Table (WebSocket connections)
################################################################################

resource "aws_dynamodb_table" "connections" {
  name         = local.connections_table_name
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

  # TTL on expiresAt for automatic stale connection cleanup
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
}
