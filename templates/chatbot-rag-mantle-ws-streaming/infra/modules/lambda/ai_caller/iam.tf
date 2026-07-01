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
  name               = "${var.project_name}-${var.environment}-ai-caller-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "ai_caller_basic_execution" {
  role       = aws_iam_role.ai_caller.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "ai_caller_permissions" {
  name   = "${var.project_name}-${var.environment}-ai-caller-permissions"
  role   = aws_iam_role.ai_caller.id
  policy = data.aws_iam_policy_document.ai_caller_permissions.json
}

data "aws_iam_policy_document" "ai_caller_permissions" {
  # Bedrock — invoke model via Mantle endpoint
  statement {
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.model_id}"
    ]
  }
}
