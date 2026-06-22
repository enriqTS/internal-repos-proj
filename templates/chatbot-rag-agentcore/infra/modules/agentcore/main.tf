# ------------------------------------------------------------------------------
# Bedrock AgentCore — Agent Runtime, Alias, and Action Group
# ------------------------------------------------------------------------------

resource "aws_bedrockagent_agent" "chatbot" {
  agent_name              = "${var.project_prefix}-agent"
  foundation_model        = var.model_id
  instruction             = var.agent_instruction
  idle_session_ttl_in_seconds = 600

  agent_resource_role_arn = aws_iam_role.agent.arn
}

resource "aws_bedrockagent_agent_alias" "chatbot" {
  agent_id         = aws_bedrockagent_agent.chatbot.agent_id
  agent_alias_name = "${var.project_prefix}-alias"
  description      = "Primary alias for ${var.project_prefix} agent"
}

resource "aws_bedrockagent_agent_action_group" "tool_executor" {
  agent_id          = aws_bedrockagent_agent.chatbot.agent_id
  action_group_name = "${var.project_prefix}-tools"
  description       = "Tool executor action group for RAG search"

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
            summary     = "Search the knowledge base"
            operationId = "searchKnowledgeBase"
            requestBody = {
              required = true
              content = {
                "application/json" = {
                  schema = {
                    type = "object"
                    properties = {
                      query = {
                        type        = "string"
                        description = "Search query for the RAG knowledge base"
                      }
                    }
                    required = ["query"]
                  }
                }
              }
            }
            responses = {
              "200" = {
                description = "Search results"
                content = {
                  "application/json" = {
                    schema = {
                      type = "object"
                      properties = {
                        results = {
                          type = "string"
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

# IAM role for the Bedrock Agent
resource "aws_iam_role" "agent" {
  name = "${var.project_prefix}-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "agent_permissions" {
  name = "${var.project_prefix}-agent-permissions"
  role = aws_iam_role.agent.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
        ]
        Resource = ["*"]
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction",
        ]
        Resource = [var.tool_executor_arn]
      }
    ]
  })
}

# Allow Bedrock to invoke the Tool Executor Lambda
resource "aws_lambda_permission" "allow_bedrock" {
  statement_id  = "AllowBedrockInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.tool_executor_arn
  principal     = "bedrock.amazonaws.com"
}
