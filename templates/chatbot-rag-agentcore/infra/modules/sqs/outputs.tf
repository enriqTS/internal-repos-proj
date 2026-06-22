output "queue_url" {
  description = "URL of the SQS FIFO message queue"
  value       = aws_sqs_queue.message_queue.url
}

output "queue_arn" {
  description = "ARN of the SQS FIFO message queue"
  value       = aws_sqs_queue.message_queue.arn
}

output "dlq_url" {
  description = "URL of the dead letter queue"
  value       = aws_sqs_queue.message_queue_dlq.url
}

output "dlq_arn" {
  description = "ARN of the dead letter queue"
  value       = aws_sqs_queue.message_queue_dlq.arn
}
