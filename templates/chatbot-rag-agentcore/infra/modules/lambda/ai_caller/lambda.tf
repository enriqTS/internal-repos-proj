data "archive_file" "ai_caller" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/ai_caller"
  output_path = "${path.root}/../../../build/ai_caller.zip"
}

resource "aws_lambda_function" "ai_caller" {
  function_name    = "${var.project_prefix}-ai-caller"
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.ai_caller.output_path
  source_code_hash = data.archive_file.ai_caller.output_base64sha256
  role             = aws_iam_role.ai_caller.arn
  timeout          = 90

  layers = [var.shared_layer_arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      AGENT_ID                = var.agent_id
      AGENT_ALIAS_ID          = var.agent_alias_id
      POWERTOOLS_SERVICE_NAME = "ai-caller"
      POWERTOOLS_LOG_LEVEL    = var.log_level
    }
  }
}
