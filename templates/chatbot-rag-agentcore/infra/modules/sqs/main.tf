# ------------------------------------------------------------------------------
# SQS FIFO Queue — Message Queue for chatbot requests
# ------------------------------------------------------------------------------

resource "aws_sqs_queue" "message_queue_dlq" {
  name                        = "${var.project_prefix}-message-queue-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true

  tags = {
    Name    = "${var.project_prefix}-message-queue-dlq"
    Project = var.project_prefix
  }
}

resource "aws_sqs_queue" "message_queue" {
  name                        = "${var.project_prefix}-message-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.message_queue_dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = {
    Name    = "${var.project_prefix}-message-queue"
    Project = var.project_prefix
  }
}
