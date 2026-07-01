"""Lambda handler for the Tool Executor — wraps shared tool executor.

Provides a Lambda entry-point around the shared tool execution logic.
In the AgentCore variant, tool execution is typically handled by the
AgentCore Runtime itself. This handler exists for custom tool implementations
that need to run as Lambda functions invoked by AgentCore Runtime.

Environment variables:
- RAG_BUCKET_NAME: S3 bucket for RAG knowledge base documents
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.tool_executor import execute_tool

logger = Logger(service="tool_executor")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Execute a tool by name and return structured results.

    Args:
        event: Dict containing:
            - toolName: Name of the tool to execute.
            - arguments: Tool-specific arguments as key-value pairs.
            - correlationId: Optional request correlation identifier.
        context: Lambda execution context.

    Returns:
        Dict with keys: toolName, status, result (on success) or error (on failure).
    """
    tool_name = event.get("toolName", "")
    arguments = event.get("arguments", {})
    correlation_id = event.get("correlationId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Tool Executor invoked",
        extra={
            "toolName": tool_name,
            "arguments": arguments,
        },
    )

    result = execute_tool(
        tool_name=tool_name,
        arguments=arguments,
        correlation_id=correlation_id,
    )

    logger.info(
        "Tool execution completed",
        extra={
            "toolName": tool_name,
            "status": result.get("status"),
        },
    )

    return result
