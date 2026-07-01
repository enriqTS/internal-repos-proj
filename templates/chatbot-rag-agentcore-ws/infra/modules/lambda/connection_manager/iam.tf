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

resource "aws_iam_role" "connection_manager" {
  name               = "${var.project_name}-${var.environment}-conn-mgr-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "connection_manager_basic_execution" {
  role       = aws_iam_role.connection_manager.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "connection_manager_permissions" {
  name   = "${var.project_name}-${var.environment}-conn-mgr-permissions"
  role   = aws_iam_role.connection_manager.id
  policy = data.aws_iam_policy_document.connection_manager_permissions.json
}

data "aws_iam_policy_document" "connection_manager_permissions" {
  # DynamoDB — Connection_Table read/write
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
    ]
    resources = [var.connections_table_arn]
  }
}
