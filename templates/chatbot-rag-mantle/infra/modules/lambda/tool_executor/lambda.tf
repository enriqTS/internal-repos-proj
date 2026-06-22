data "archive_file" "tool_executor" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/tool_executor"
  output_path = "${path.root}/../../../build/tool_executor.zip"
}

resource "aws_lambda_function" "tool_executor" {
  function_name    = "${var.project_prefix}-tool-executor"
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.tool_executor.output_path
  source_code_hash = data.archive_file.tool_executor.output_base64sha256
  role             = aws_iam_role.tool_executor.arn
  timeout          = 30

  layers = [var.shared_layer_arn]

  environment {
    variables = {
      RAG_BUCKET_NAME        = var.rag_bucket_name
      POWERTOOLS_SERVICE_NAME = "tool-executor"
      POWERTOOLS_LOG_LEVEL   = var.log_level
    }
  }
}
