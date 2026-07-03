# ------------------------------------------------------------------------------
# Bedrock AgentCore — Agent, Alias, and Action Group
# ------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# IAM role for the Bedrock Agent
data "aws_iam_policy_document" "agent_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "agent" {
  name               = "${local.name_prefix}-agentcore-role"
  assume_role_policy = data.aws_iam_policy_document.agent_assume.json
}

resource "aws_iam_role_policy" "agent_model_invocation" {
  name   = "${local.name_prefix}-agent-model-invocation"
  role   = aws_iam_role.agent.id
  policy = data.aws_iam_policy_document.agent_model_invocation.json
}

data "aws_iam_policy_document" "agent_model_invocation" {
  statement {
    effect  = "Allow"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:${data.aws_region.current.region}::foundation-model/${var.model_id}"
    ]
  }
}

# Bedrock Agent
resource "aws_bedrockagent_agent" "chatbot" {
  agent_name                  = "${local.name_prefix}-agent"
  agent_resource_role_arn     = aws_iam_role.agent.arn
  foundation_model            = var.model_id
  instruction                 = var.agent_instruction
  idle_session_ttl_in_seconds = 600
}

# Agent Alias — points to the latest prepared version
resource "aws_bedrockagent_agent_alias" "chatbot" {
  agent_id         = aws_bedrockagent_agent.chatbot.agent_id
  agent_alias_name = "${local.name_prefix}-alias"
  description      = "Production alias for ${local.name_prefix} agent"
}

# ------------------------------------------------------------------------------
# Knowledge Base Association — native RAG retrieval without Lambda hop
# ------------------------------------------------------------------------------

resource "aws_bedrockagent_agent_knowledge_base_association" "kb" {
  agent_id             = aws_bedrockagent_agent.chatbot.agent_id
  description          = "RAG Knowledge Base for ${local.name_prefix} agent"
  knowledge_base_id    = var.knowledge_base_id
  knowledge_base_state = "ENABLED"
}

# IAM — allow agent to retrieve from the Knowledge Base
resource "aws_iam_role_policy" "agent_kb_retrieval" {
  name   = "${local.name_prefix}-agent-kb-retrieval"
  role   = aws_iam_role.agent.id
  policy = data.aws_iam_policy_document.agent_kb_retrieval.json
}

data "aws_iam_policy_document" "agent_kb_retrieval" {
  statement {
    effect  = "Allow"
    actions = ["bedrock:Retrieve"]
    resources = [
      "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:knowledge-base/${var.knowledge_base_id}"
    ]
  }
}
