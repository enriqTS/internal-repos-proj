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

resource "aws_iam_role" "kb_sync" {
  name               = "${var.project_name}-${var.environment}-kb-sync-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "kb_sync_basic_execution" {
  role       = aws_iam_role.kb_sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "kb_sync_permissions" {
  name   = "${var.project_name}-${var.environment}-kb-sync-permissions"
  role   = aws_iam_role.kb_sync.id
  policy = data.aws_iam_policy_document.kb_sync_permissions.json
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "kb_sync_permissions" {
  statement {
    effect  = "Allow"
    actions = ["bedrock:StartIngestionJob"]
    resources = [
      "arn:aws:bedrock:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:knowledge-base/${var.knowledge_base_id}"
    ]
  }
}
