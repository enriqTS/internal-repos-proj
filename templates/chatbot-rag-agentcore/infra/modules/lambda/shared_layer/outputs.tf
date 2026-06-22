output "layer_arn" {
  description = "ARN of the shared Lambda layer version"
  value       = aws_lambda_layer_version.shared.arn
}

output "layer_name" {
  description = "Name of the shared Lambda layer"
  value       = aws_lambda_layer_version.shared.layer_name
}
