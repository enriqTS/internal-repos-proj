locals {
  function_name = "${var.project_name}-${var.environment}-responses-reader"
}

data "archive_file" "responses_reader" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/responses_reader"
  output_path = "${path.root}/../../../build/responses_reader.zip"
}

resource "aws_lambda_function" "responses_reader" {
  function_name    = local.function_name
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.responses_reader.output_path
  source_code_hash = data.archive_file.responses_reader.output_base64sha256
  role             = aws_iam_role.responses_reader.arn
  timeout          = 10

  tracing_config {
    mode = "Active"
  }

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      RESPONSES_TABLE_NAME    = var.responses_table_name
      POWERTOOLS_SERVICE_NAME = "responses-reader"
      POWERTOOLS_LOG_LEVEL    = var.log_level
    }
  }
}
