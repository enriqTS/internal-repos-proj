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

resource "aws_iam_role" "ai_caller" {
  name               = "${var.project_prefix}-ai-caller-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "ai_caller_basic_execution" {
  role       = aws_iam_role.ai_caller.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "ai_caller_permissions" {
  name   = "${var.project_prefix}-ai-caller-permissions"
  role   = aws_iam_role.ai_caller.id
  policy = data.aws_iam_policy_document.ai_caller_permissions.json
}

data "aws_iam_policy_document" "ai_caller_permissions" {
  statement {
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["*"]
  }
}
