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

# Mantle (Bedrock) configuration
MANTLE_BASE_URL: str = os.environ.get(
    "MANTLE_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/v1"
)
MODEL_ID: str = os.environ.get("MODEL_ID", "your-model-id")

# Tool-use loop configuration
MAX_TOOL_ITERATIONS: int = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))

# Conversation configuration
MAX_CONVERSATION_HISTORY: int = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))

# Observability configuration
POWERTOOLS_SERVICE_NAME: str = os.environ.get("POWERTOOLS_SERVICE_NAME", "chatbot-ecs")
POWERTOOLS_LOG_LEVEL: str = os.environ.get("POWERTOOLS_LOG_LEVEL", "INFO")
