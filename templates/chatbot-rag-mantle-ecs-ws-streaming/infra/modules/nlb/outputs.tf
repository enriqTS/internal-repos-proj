output "nlb_arn" {
  description = "ARN of the Network Load Balancer"
  value       = aws_lb.main.arn
}

output "nlb_dns_name" {
  description = "DNS name of the Network Load Balancer"
  value       = aws_lb.main.dns_name
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = aws_lb_target_group.chatbot.arn
}

output "listener_arn" {
  description = "ARN of the TCP listener"
  value       = aws_lb_listener.tcp.arn
}

output "security_group_id" {
  description = "ID of the NLB security group"
  value       = aws_security_group.nlb.id
}
