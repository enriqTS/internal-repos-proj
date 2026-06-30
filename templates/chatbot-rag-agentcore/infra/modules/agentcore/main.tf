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

# Action Group — registers the Tool Executor Lambda for tool execution
resource "aws_bedrockagent_agent_action_group" "tools" {
  agent_id          = aws_bedrockagent_agent.chatbot.agent_id
  agent_version     = "DRAFT"
  action_group_name = "${local.name_prefix}-tools"
  description       = "Action group for RAG tool execution"

  action_group_executor {
    lambda = var.tool_executor_arn
  }

  api_schema {
    payload = jsonencode({
      openapi = "3.0.0"
      info = {
        title   = "Tool Executor API"
        version = "1.0.0"
      }
      paths = {
        "/search" = {
          post = {
            operationId = "search_knowledge_base"
            description = "Search the RAG knowledge base for relevant documents"
            requestBody = {
              required = true
              content = {
                "application/json" = {
                  schema = {
                    type = "object"
                    properties = {
                      query = {
                        type        = "string"
                        description = "Search query to find relevant documents in the knowledge base"
                      }
                    }
                    required = ["query"]
                  }
                }
              }
            }
            responses = {
              "200" = {
                description = "Search results from the knowledge base"
                content = {
                  "application/json" = {
                    schema = {
                      type = "object"
                      properties = {
                        results = {
                          type        = "string"
                          description = "Retrieved document content"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
  }
}

# Grant AgentCore permission to invoke the Tool Executor Lambda
resource "aws_lambda_permission" "allow_agentcore" {
  statement_id  = "AllowBedrockAgentInvocation"
  action        = "lambda:InvokeFunction"
  function_name = var.tool_executor_arn
  principal     = "bedrock.amazonaws.com"
  source_arn    = aws_bedrockagent_agent.chatbot.agent_arn
}
