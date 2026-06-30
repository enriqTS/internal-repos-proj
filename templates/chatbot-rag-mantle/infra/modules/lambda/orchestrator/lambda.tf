data "archive_file" "orchestrator" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/orchestrator"
  output_path = "${path.root}/../../../build/orchestrator.zip"
}

resource "aws_lambda_function" "orchestrator" {
  function_name    = "${var.project_prefix}-orchestrator"
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.orchestrator.output_path
  source_code_hash = data.archive_file.orchestrator.output_base64sha256
  role             = aws_iam_role.orchestrator.arn
  timeout          = 150

  tracing_config {
    mode = "Active"
  }

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      MAX_CONVERSATION_HISTORY    = var.max_conversation_history
      MAX_RETRY_ATTEMPTS          = var.max_retry_attempts
      MAX_TOOL_ITERATIONS         = var.max_tool_iterations
      AI_CALLER_FUNCTION_NAME     = var.ai_caller_function_name
      TOOL_EXECUTOR_FUNCTION_NAME = var.tool_executor_function_name
      DYNAMODB_TABLE_NAME         = var.dynamodb_table_name
      POWERTOOLS_SERVICE_NAME     = "orchestrator"
      POWERTOOLS_LOG_LEVEL        = var.log_level
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = var.sqs_queue_arn
  function_name    = aws_lambda_function.orchestrator.arn
  batch_size       = 1
  enabled          = true
}
