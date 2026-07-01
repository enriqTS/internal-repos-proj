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

resource "aws_iam_role" "tool_executor" {
  name               = "${var.project_name}-${var.environment}-tool-executor-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "tool_executor_basic_execution" {
  role       = aws_iam_role.tool_executor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "tool_executor_permissions" {
  name   = "${var.project_name}-${var.environment}-tool-executor-permissions"
  role   = aws_iam_role.tool_executor.id
  policy = data.aws_iam_policy_document.tool_executor_permissions.json
}

data "aws_iam_policy_document" "tool_executor_permissions" {
  # S3 — RAG bucket read access
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      var.rag_bucket_arn,
      "${var.rag_bucket_arn}/*",
    ]
  }
}
