"""Environment variable loading with defaults.

All configuration is loaded from environment variables, injected by the ECS
task definition (Terraform). No hardcoded values — everything that varies
between environments is configurable here.
"""

import os

# Server configuration
PORT: int = int(os.environ.get("PORT", "8080"))

# DynamoDB configuration
DYNAMODB_TABLE_NAME: str = os.environ.get("DYNAMODB_TABLE_NAME", "")

# S3 RAG configuration
RAG_BUCKET_NAME: str = os.environ.get("RAG_BUCKET_NAME", "")

# AgentCore configuration
AGENT_RUNTIME_ARN: str = os.environ.get("AGENT_RUNTIME_ARN", "")
AGENT_ALIAS_ID: str = os.environ.get("AGENT_ALIAS_ID", "TSTALIASID")
AGENT_ID: str = os.environ.get("AGENT_ID", "")

# Conversation configuration
MAX_CONVERSATION_HISTORY: int = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))

# Observability configuration
POWERTOOLS_SERVICE_NAME: str = os.environ.get("POWERTOOLS_SERVICE_NAME", "chatbot-ecs")
POWERTOOLS_LOG_LEVEL: str = os.environ.get("POWERTOOLS_LOG_LEVEL", "INFO")
