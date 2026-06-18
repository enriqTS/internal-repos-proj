output "cloudfront_distribution_url" {
  description = "The domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.frontend.id
}

output "api_gateway_endpoint" {
  description = "The invoke URL for the API Gateway stage (without resource path)"
  value       = aws_api_gateway_stage.prod.invoke_url
}

output "s3_bucket_name" {
  description = "The name of the S3 bucket hosting the static site and project files"
  value       = aws_s3_bucket.frontend.id
}

output "s3_bucket_arn" {
  description = "The ARN of the S3 bucket"
  value       = aws_s3_bucket.frontend.arn
}

output "api_key_value" {
  description = "The auto-generated API key value for the upload endpoint"
  value       = aws_api_gateway_api_key.upload_key.value
  sensitive   = true
}

output "initiate_lambda_function_name" {
  description = "The name of the initiate Lambda function"
  value       = aws_lambda_function.initiate_lambda.function_name
}

output "process_lambda_function_name" {
  description = "The name of the processing Lambda function"
  value       = aws_lambda_function.process_lambda.function_name
}
