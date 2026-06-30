output "dashboard_arn" {
  description = "ARN of the CloudWatch Dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_arn
}

output "error_rate_alarm_arn" {
  description = "ARN of the Lambda error rate alarm"
  value       = aws_cloudwatch_metric_alarm.lambda_error_rate.arn
}

output "p99_latency_alarm_arn" {
  description = "ARN of the p99 latency alarm"
  value       = aws_cloudwatch_metric_alarm.p99_latency.arn
}

output "dlq_depth_alarm_arn" {
  description = "ARN of the DLQ depth alarm"
  value       = aws_cloudwatch_metric_alarm.dlq_depth.arn
}
