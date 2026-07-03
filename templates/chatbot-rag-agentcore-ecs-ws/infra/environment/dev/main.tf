locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

################################################################################
# VPC
################################################################################

module "vpc" {
  source       = "../../modules/vpc"
  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
}

################################################################################
# ECR
################################################################################

module "ecr" {
  source       = "../../modules/ecr"
  project_name = var.project_name
  environment  = var.environment
}

################################################################################
# NLB (replaces ALB for WebSocket variant)
################################################################################

module "nlb" {
  source       = "../../modules/nlb"
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id

  private_subnet_ids = module.vpc.private_subnet_ids
  container_port     = var.container_port

  health_check_interval = var.health_check_interval
  health_check_timeout  = var.health_check_timeout
  healthy_threshold     = var.healthy_threshold
  unhealthy_threshold   = var.unhealthy_threshold
  deregistration_delay  = var.deregistration_delay
}

################################################################################
# WebSocket API (API Gateway v2 WebSocket + VPC Link)
################################################################################

module "websocket_api" {
  source       = "../../modules/websocket_api"
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  private_subnet_ids         = module.vpc.private_subnet_ids
  vpc_link_security_group_id = module.ecs.security_group_id
  nlb_listener_arn           = module.nlb.listener_arn
}

################################################################################
# AgentCore
################################################################################

module "agentcore" {
  source       = "../../modules/agentcore"
  project_name = var.project_name
  environment  = var.environment
  model_id     = var.model_id
}

################################################################################
# ECS
################################################################################

module "ecs" {
  source       = "../../modules/ecs"
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  desired_count  = var.desired_count
  cpu_units      = var.cpu_units
  memory_mib     = var.memory_mib
  container_port = var.container_port
  log_level      = var.log_level

  max_conversation_history = var.max_conversation_history

  ecr_repository_url = module.ecr.repository_url
  ecr_repository_arn = module.ecr.repository_arn

  dynamodb_table_name = module.dynamodb.user_context_table_name
  dynamodb_table_arn  = module.dynamodb.user_context_table_arn

  connections_table_name = module.dynamodb.connections_table_name
  connections_table_arn  = module.dynamodb.connections_table_arn

  rag_bucket_name = module.s3.bucket_name
  rag_bucket_arn  = module.s3.bucket_arn

  agent_id       = module.agentcore.agent_id
  agent_alias_id = module.agentcore.agent_alias_id
  agent_arn      = module.agentcore.agent_arn

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids

  target_group_arn = module.nlb.target_group_arn
  nlb_listener_arn = module.nlb.listener_arn

  websocket_api_endpoint  = module.websocket_api.api_management_endpoint
  websocket_api_stage_arn = module.websocket_api.stage_arn
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
# WAF — API key authentication (disabled for WebSocket — WAFv2 does not
# support API Gateway v2 WebSocket APIs; auth is handled at API GW level)
################################################################################

module "waf" {
  source        = "../../modules/waf"
  project_name  = var.project_name
  environment   = var.environment
  alb_arn       = ""
  api_key_value = var.api_key_value
  waf_enabled   = var.waf_enabled
}

################################################################################
# KB Sync Lambda (S3 event → Bedrock Knowledge Base ingestion)
################################################################################

module "shared_layer" {
  source       = "../../modules/lambda/shared_layer"
  project_name = var.project_name
  environment  = var.environment
}

module "kb_sync" {
  source            = "../../modules/lambda/kb_sync"
  project_name      = var.project_name
  environment       = var.environment
  shared_layer_arn  = module.shared_layer.layer_arn
  knowledge_base_id = var.knowledge_base_id
  data_source_id    = var.data_source_id
  log_level         = var.log_level
  memory_size       = 256
}
