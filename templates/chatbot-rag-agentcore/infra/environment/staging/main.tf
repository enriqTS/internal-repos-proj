locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

module "agentcore" {
  source            = "../../modules/agentcore"
  project_name      = var.project_name
  environment       = var.environment
  model_id          = var.model_id
  agent_instruction = "You are a helpful assistant."
}

module "api_gateway" {
  source       = "../../modules/api_gateway"
  project_name = var.project_name
  environment  = var.environment
  openapi_spec = templatefile("${path.root}/../../openapi/api-spec.json", {
    name_prefix                 = local.name_prefix
    region                      = var.aws_region
    api_gateway_role_arn        = "arn:aws:iam::${var.aws_account_id}:role/${local.name_prefix}-apigw-role"
    sqs_queue_url               = module.sqs.queue_url
    responses_reader_lambda_uri = module.responses_reader.invoke_arn
  })
  aws_region                     = var.aws_region
  sqs_queue_url                  = module.sqs.queue_url
  sqs_queue_arn                  = module.sqs.queue_arn
  responses_reader_invoke_arn    = module.responses_reader.invoke_arn
  responses_reader_function_name = module.responses_reader.function_name
}

module "sqs" {
  source       = "../../modules/sqs"
  project_name = var.project_name
  environment  = var.environment
}

module "orchestrator" {
  source                   = "../../modules/lambda/orchestrator"
  project_name             = var.project_name
  environment              = var.environment
  sqs_queue_arn            = module.sqs.queue_arn
  dynamodb_table_arn       = module.dynamodb.table_arn
  dynamodb_table_name      = module.dynamodb.table_name
  ai_caller_arn            = module.ai_caller.function_arn
  ai_caller_function_name  = module.ai_caller.function_name
  shared_layer_arn         = module.shared_layer.layer_arn
  responses_table_arn      = module.dynamodb_responses.table_arn
  responses_table_name     = module.dynamodb_responses.table_name
  max_conversation_history = var.max_conversation_history
  max_retry_attempts       = var.max_retry_attempts
  log_level                = var.log_level
}

module "ai_caller" {
  source           = "../../modules/lambda/ai_caller"
  project_name     = var.project_name
  environment      = var.environment
  shared_layer_arn = module.shared_layer.layer_arn
  agent_id         = module.agentcore.agent_id
  agent_alias_id   = module.agentcore.agent_alias_id
  log_level        = var.log_level
}

module "shared_layer" {
  source       = "../../modules/lambda/shared_layer"
  project_name = var.project_name
  environment  = var.environment
}

module "dynamodb" {
  source       = "../../modules/dynamodb"
  project_name = var.project_name
  environment  = var.environment
}

module "dynamodb_responses" {
  source       = "../../modules/dynamodb_responses"
  project_name = var.project_name
  environment  = var.environment
}

module "responses_reader" {
  source               = "../../modules/lambda/responses_reader"
  project_name         = var.project_name
  environment          = var.environment
  shared_layer_arn     = module.shared_layer.layer_arn
  responses_table_arn  = module.dynamodb_responses.table_arn
  responses_table_name = module.dynamodb_responses.table_name
  log_level            = var.log_level
}

module "s3" {
  source                       = "../../modules/s3"
  project_name                 = var.project_name
  environment                  = var.environment
  kb_sync_lambda_arn           = module.kb_sync.function_arn
  kb_sync_lambda_function_name = module.kb_sync.function_name
}

module "bedrock_kb" {
  source         = "../../modules/bedrock_kb"
  project_name   = var.project_name
  environment    = var.environment
  rag_bucket_arn = module.s3.bucket_arn
}

module "kb_sync" {
  source            = "../../modules/lambda/kb_sync"
  project_name      = var.project_name
  environment       = var.environment
  shared_layer_arn  = module.shared_layer.layer_arn
  knowledge_base_id = module.bedrock_kb.knowledge_base_id
  data_source_id    = module.bedrock_kb.data_source_id
  log_level         = var.log_level
}

module "monitoring" {
  source                     = "../../modules/monitoring"
  project_name               = var.project_name
  environment                = var.environment
  aws_region                 = var.aws_region
  orchestrator_function_name = module.orchestrator.function_name
  ai_caller_function_name    = module.ai_caller.function_name
  kb_sync_function_name      = module.kb_sync.function_name
  dlq_name                   = module.sqs.dlq_name
}
