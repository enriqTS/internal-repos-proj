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

resource "aws_iam_role" "responses_reader" {
  name               = "${var.project_name}-${var.environment}-responses-reader-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "responses_reader_basic_execution" {
  role       = aws_iam_role.responses_reader.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "responses_reader_permissions" {
  name   = "${var.project_name}-${var.environment}-responses-reader-permissions"
  role   = aws_iam_role.responses_reader.id
  policy = data.aws_iam_policy_document.responses_reader_permissions.json
}

data "aws_iam_policy_document" "responses_reader_permissions" {
  statement {
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [var.responses_table_arn]
  }
}
