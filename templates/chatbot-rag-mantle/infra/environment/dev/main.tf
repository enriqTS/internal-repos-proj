terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "api_gateway" {
  source         = "../../modules/api_gateway"
  project_prefix = var.project_prefix
  openapi_spec   = file("${path.root}/../../openapi/api-spec.json")
  aws_region     = var.aws_region
  sqs_queue_url  = module.sqs.queue_url
  sqs_queue_arn  = module.sqs.queue_arn
}

module "sqs" {
  source         = "../../modules/sqs"
  project_prefix = var.project_prefix
}

module "orchestrator" {
  source                      = "../../modules/lambda/orchestrator"
  project_prefix              = var.project_prefix
  sqs_queue_arn               = module.sqs.queue_arn
  dynamodb_table_arn          = module.dynamodb.table_arn
  dynamodb_table_name         = module.dynamodb.table_name
  ai_caller_arn               = module.ai_caller.function_arn
  ai_caller_function_name     = module.ai_caller.function_name
  tool_executor_arn           = module.tool_executor.function_arn
  tool_executor_function_name = module.tool_executor.function_name
  shared_layer_arn            = module.shared_layer.layer_arn
  max_conversation_history    = var.max_conversation_history
  max_retry_attempts          = var.max_retry_attempts
  log_level                   = var.log_level
}

module "ai_caller" {
  source           = "../../modules/lambda/ai_caller"
  project_prefix   = var.project_prefix
  shared_layer_arn = module.shared_layer.layer_arn
  mantle_base_url  = var.mantle_base_url
  model_id         = var.model_id
  log_level        = var.log_level
}

module "tool_executor" {
  source           = "../../modules/lambda/tool_executor"
  project_prefix   = var.project_prefix
  rag_bucket_name  = module.s3.bucket_name
  rag_bucket_arn   = module.s3.bucket_arn
  shared_layer_arn = module.shared_layer.layer_arn
  log_level        = var.log_level
}

module "shared_layer" {
  source         = "../../modules/lambda/shared_layer"
  project_prefix = var.project_prefix
}

module "dynamodb" {
  source         = "../../modules/dynamodb"
  project_prefix = var.project_prefix
}

module "s3" {
  source         = "../../modules/s3"
  project_prefix = var.project_prefix
}
