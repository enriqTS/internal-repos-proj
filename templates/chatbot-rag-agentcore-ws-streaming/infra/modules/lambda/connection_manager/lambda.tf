locals {
  function_name = "${var.project_name}-${var.environment}-connection-manager"
}

data "archive_file" "connection_manager" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/connection_manager"
  output_path = "${path.root}/../../../build/connection_manager.zip"
}

resource "aws_lambda_function" "connection_manager" {
  function_name    = local.function_name
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.connection_manager.output_path
  source_code_hash = data.archive_file.connection_manager.output_base64sha256
  role             = aws_iam_role.connection_manager.arn
  timeout          = 10

  tracing_config {
    mode = "Active"
  }

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      CONNECTION_TABLE_NAME   = var.connections_table_name
      CONNECTION_TTL_SECONDS  = var.connection_ttl_seconds
      POWERTOOLS_SERVICE_NAME = "connection-manager"
      POWERTOOLS_LOG_LEVEL    = var.log_level
    }
  }
}
