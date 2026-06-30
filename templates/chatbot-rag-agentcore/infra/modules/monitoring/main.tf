# ------------------------------------------------------------------------------
# CloudWatch Dashboard
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "Message Processing Latency"
          metrics = [
            ["ChatbotRAG", "MessageProcessingLatency", "service", "orchestrator", { stat = "p50", label = "p50" }],
            ["ChatbotRAG", "MessageProcessingLatency", "service", "orchestrator", { stat = "p99", label = "p99" }]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title = "AI Model Latency"
          metrics = [
            ["ChatbotRAG", "AIModelLatency", "service", "ai-caller", { stat = "p50", label = "p50" }],
            ["ChatbotRAG", "AIModelLatency", "service", "ai-caller", { stat = "p99", label = "p99" }]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "Tool Execution Latency"
          metrics = [
            ["ChatbotRAG", "ToolExecutionLatency", "service", "tool-executor", { stat = "p50", label = "p50" }],
            ["ChatbotRAG", "ToolExecutionLatency", "service", "tool-executor", { stat = "p99", label = "p99" }]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title = "DLQ Depth"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.dlq_name]
          ]
          period = 60
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title = "Lambda Errors"
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", var.orchestrator_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.ai_caller_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.tool_executor_function_name],
            ["AWS/Lambda", "Errors", "FunctionName", var.kb_sync_function_name]
          ]
          period = 300
          region = var.aws_region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title = "Conversation Length"
          metrics = [
            ["ChatbotRAG", "ConversationLength", "service", "orchestrator", { stat = "Average" }]
          ]
          period = 300
          region = var.aws_region
        }
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# CloudWatch Alarms
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "lambda_error_rate" {
  alarm_name          = "${var.project_prefix}-lambda-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Lambda error rate exceeds 5% over 5 minutes"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = var.orchestrator_function_name
      }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = var.orchestrator_function_name
      }
    }
  }

  alarm_actions = var.sns_alarm_topic_arn != "" ? [var.sns_alarm_topic_arn] : []

  tags = {
    Project = var.project_prefix
  }
}

resource "aws_cloudwatch_metric_alarm" "p99_latency" {
  alarm_name          = "${var.project_prefix}-p99-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = var.sla_latency_threshold_ms
  alarm_description   = "Orchestrator p99 latency exceeds SLA threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.orchestrator_function_name
  }

  alarm_actions = var.sns_alarm_topic_arn != "" ? [var.sns_alarm_topic_arn] : []

  tags = {
    Project = var.project_prefix
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${var.project_prefix}-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.dlq_depth_threshold
  alarm_description   = "DLQ message count exceeds threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.dlq_name
  }

  alarm_actions = var.sns_alarm_topic_arn != "" ? [var.sns_alarm_topic_arn] : []

  tags = {
    Project = var.project_prefix
  }
}
