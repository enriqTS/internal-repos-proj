resource "aws_wafv2_web_acl" "this" {
  count = var.waf_enabled ? 1 : 0

  name        = "${var.project_name}-${var.environment}-waf"
  description = "WAF WebACL for API key authentication on ALB"
  scope       = "REGIONAL"

  default_action {
    block {}
  }

  rule {
    name     = "allow-health-check"
    priority = 1

    action {
      allow {}
    }

    statement {
      byte_match_statement {
        search_string = "/health"
        field_to_match {
          uri_path {}
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
        positional_constraint = "STARTS_WITH"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-allow-health"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "allow-valid-api-key"
    priority = 2

    action {
      allow {}
    }

    statement {
      byte_match_statement {
        search_string = var.api_key_value
        field_to_match {
          single_header {
            name = "x-api-key"
          }
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
        positional_constraint = "EXACTLY"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-allow-api-key"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-${var.environment}-waf"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-waf"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  count = var.waf_enabled ? 1 : 0

  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this[0].arn
}
