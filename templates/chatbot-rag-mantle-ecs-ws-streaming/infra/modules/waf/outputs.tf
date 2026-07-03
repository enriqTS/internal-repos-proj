output "web_acl_arn" {
  description = "ARN of the WAF WebACL"
  value       = var.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null
}
