################################################################################
# SQS FIFO Queue — Message Queue for WebSocket sendMessage route
################################################################################

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "aws_sqs_queue" "message_queue_dlq" {
  name                        = "${local.name_prefix}-message-queue-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
}

resource "aws_sqs_queue" "message_queue" {
  name                        = "${local.name_prefix}-message-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.message_queue_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}
