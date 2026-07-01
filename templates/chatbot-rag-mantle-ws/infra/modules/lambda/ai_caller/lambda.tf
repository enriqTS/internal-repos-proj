locals {
  function_name = "${var.project_name}-${var.environment}-ai-caller"
}

data "archive_file" "ai_caller" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/ai_caller"
  output_path = "${path.root}/../../../build/ai_caller.zip"
}

resource "aws_lambda_function" "ai_caller" {
  function_name    = local.function_name
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.ai_caller.output_path
  source_code_hash = data.archive_file.ai_caller.output_base64sha256
  role             = aws_iam_role.ai_caller.arn
  timeout          = 120

  tracing_config {
    mode = "Active"
  }

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      MANTLE_BASE_URL        = var.mantle_base_url
      MODEL_ID               = var.model_id
      POWERTOOLS_SERVICE_NAME = "ai-caller"
      POWERTOOLS_LOG_LEVEL    = var.log_level
    }
  }
}
