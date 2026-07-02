data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "orchestrator" {
  name               = "${var.project_name}-${var.environment}-orchestrator-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "orchestrator_basic_execution" {
  role       = aws_iam_role.orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "orchestrator_permissions" {
  name   = "${var.project_name}-${var.environment}-orchestrator-permissions"
  role   = aws_iam_role.orchestrator.id
  policy = data.aws_iam_policy_document.orchestrator_permissions.json
}

data "aws_iam_policy_document" "orchestrator_permissions" {
  # DynamoDB — User Context table read/write
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
    ]
    resources = [var.dynamodb_table_arn]
  }

  # DynamoDB — Connection table read (to look up connectionId by userId)
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [
      var.connections_table_arn,
      "${var.connections_table_arn}/index/userId-index",
    ]
  }

  # Lambda — invoke AI Caller
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [var.ai_caller_arn]
  }

  # API Gateway — send messages back to WebSocket clients
  statement {
    effect = "Allow"
    actions = [
      "execute-api:ManageConnections",
    ]
    resources = [var.websocket_api_stage_arn]
  }
}
