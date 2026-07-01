locals {
  name_prefix = "${var.project_name}-${var.environment}"
  # WebSocket API management endpoint for @connections POST
  websocket_api_endpoint = "https://${module.websocket_api.api_id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
}

################################################################################
# WebSocket API
################################################################################

module "websocket_api" {
  source                           = "../../modules/websocket_api"
  project_name                     = var.project_name
  environment                      = var.environment
  aws_region                       = var.aws_region
  connection_manager_invoke_arn    = module.connection_manager.invoke_arn
  connection_manager_function_name = module.connection_manager.function_name
  sqs_queue_url                    = module.sqs.queue_url
  sqs_queue_arn                    = module.sqs.queue_arn
}

################################################################################
# SQS
################################################################################

module "sqs" {
  source       = "../../modules/sqs"
  project_name = var.project_name
  environment  = var.environment
}

################################################################################
# Lambda Functions
################################################################################

module "shared_layer" {
  source       = "../../modules/lambda/shared_layer"
  project_name = var.project_name
  environment  = var.environment
}

module "connection_manager" {
  source                 = "../../modules/lambda/connection_manager"
  project_name           = var.project_name
  environment            = var.environment
  shared_layer_arn       = module.shared_layer.layer_arn
  connections_table_name = module.dynamodb.connections_table_name
  connections_table_arn  = module.dynamodb.connections_table_arn
  connection_ttl_seconds = tostring(var.connection_ttl_seconds)
  log_level              = var.log_level
}

module "orchestrator" {
  source                   = "../../modules/lambda/orchestrator"
  project_name             = var.project_name
  environment              = var.environment
  shared_layer_arn         = module.shared_layer.layer_arn
  sqs_queue_arn            = module.sqs.queue_arn
  dynamodb_table_name      = module.dynamodb.user_context_table_name
  dynamodb_table_arn       = module.dynamodb.user_context_table_arn
  connections_table_name   = module.dynamodb.connections_table_name
  connections_table_arn    = module.dynamodb.connections_table_arn
  ai_caller_arn            = module.ai_caller.function_arn
  ai_caller_function_name  = module.ai_caller.function_name
  websocket_api_endpoint   = local.websocket_api_endpoint
  websocket_api_stage_arn  = module.websocket_api.stage_arn
  rag_bucket_name          = module.s3.bucket_name
  rag_bucket_arn           = module.s3.bucket_arn
  max_conversation_history = tostring(var.max_conversation_history)
  max_tool_iterations      = tostring(var.max_tool_iterations)
  max_chunk_size           = tostring(var.max_chunk_size)
  log_level                = var.log_level
}

module "ai_caller" {
  source           = "../../modules/lambda/ai_caller"
  project_name     = var.project_name
  environment      = var.environment
  shared_layer_arn = module.shared_layer.layer_arn
  mantle_base_url  = var.mantle_base_url
  model_id         = var.model_id
  aws_region       = var.aws_region
  aws_account_id   = var.aws_account_id
  log_level        = var.log_level
}

module "tool_executor" {
  source           = "../../modules/lambda/tool_executor"
  project_name     = var.project_name
  environment      = var.environment
  shared_layer_arn = module.shared_layer.layer_arn
  rag_bucket_name  = module.s3.bucket_name
  rag_bucket_arn   = module.s3.bucket_arn
  log_level        = var.log_level
}

################################################################################
# DynamoDB
################################################################################

module "dynamodb" {
  source       = "../../modules/dynamodb"
  project_name = var.project_name
  environment  = var.environment
}

################################################################################
# S3
################################################################################

module "s3" {
  source                       = "../../modules/s3"
  project_name                 = var.project_name
  environment                  = var.environment
  kb_sync_lambda_arn           = module.kb_sync.function_arn
  kb_sync_lambda_function_name = module.kb_sync.function_name
}

################################################################################
# KB Sync (S3 event → Bedrock Knowledge Base ingestion)
################################################################################

module "kb_sync" {
  source            = "../../modules/lambda/kb_sync"
  project_name      = var.project_name
  environment       = var.environment
  shared_layer_arn  = module.shared_layer.layer_arn
  knowledge_base_id = var.knowledge_base_id
  data_source_id    = var.data_source_id
  log_level         = var.log_level
}
