variable "project_prefix" {
  description = "Prefix for all resource names"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "orchestrator_function_name" {
  description = "Name of the Orchestrator Lambda function"
  type        = string
}

variable "ai_caller_function_name" {
  description = "Name of the AI Caller Lambda function"
  type        = string
}

variable "tool_executor_function_name" {
  description = "Name of the Tool Executor Lambda function"
  type        = string
}

variable "kb_sync_function_name" {
  description = "Name of the KB Sync Lambda function"
  type        = string
}

variable "dlq_name" {
  description = "Name of the SQS dead-letter queue"
  type        = string
}

variable "sla_latency_threshold_ms" {
  description = "P99 latency SLA threshold in milliseconds"
  type        = number
  default     = 120000
}

variable "dlq_depth_threshold" {
  description = "DLQ message count alarm threshold"
  type        = number
  default     = 1
}

variable "sns_alarm_topic_arn" {
  description = "SNS topic ARN for alarm notifications (optional)"
  type        = string
  default     = ""
}
