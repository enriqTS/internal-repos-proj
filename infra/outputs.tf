output "cloudfront_distribution_url" {
  description = "The domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "api_gateway_endpoint" {
  description = "The invoke URL for the API Gateway upload endpoint"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/upload"
}

output "s3_bucket_name" {
  description = "The name of the S3 bucket hosting the static site and project files"
  value       = aws_s3_bucket.frontend.id
}

output "s3_bucket_arn" {
  description = "The ARN of the S3 bucket"
  value       = aws_s3_bucket.frontend.arn
}
