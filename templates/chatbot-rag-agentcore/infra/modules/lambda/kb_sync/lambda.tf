data "archive_file" "kb_sync" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/kb_sync"
  output_path = "${path.root}/../../../build/kb_sync.zip"
}

resource "aws_lambda_function" "kb_sync" {
  function_name    = "${var.project_prefix}-kb-sync"
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.kb_sync.output_path
  source_code_hash = data.archive_file.kb_sync.output_base64sha256
  role             = aws_iam_role.kb_sync.arn
  timeout          = 30

  tracing_config {
    mode = "Active"
  }

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      KNOWLEDGE_BASE_ID       = var.knowledge_base_id
      DATA_SOURCE_ID          = var.data_source_id
      POWERTOOLS_SERVICE_NAME = "kb-sync"
      POWERTOOLS_LOG_LEVEL    = var.log_level
    }
  }
}
