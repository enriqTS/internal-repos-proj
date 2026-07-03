"""Tool Executor module for ECS in-process use.

Provides the tool dispatch and execution logic. Handles tool routing,
RAG knowledge base search via S3, and structured result formatting.

Configuration via environment variables:
- RAG_BUCKET_NAME: S3 bucket name for RAG document storage

This module contains the same core logic as the Lambda tool executor variant.
The only differences are module import paths and the absence of the Lambda
handler entry-point wrapper.
"""

import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError

logger = Logger(service="tool_executor")

RAG_BUCKET_NAME = os.environ.get("RAG_BUCKET_NAME", "")

_s3_client = None


def _get_s3_client():
    """Lazy-initialize the S3 client for connection reuse across invocations.

    Returns:
        Boto3 S3 client instance.
    """
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


# Registry of available tools. Add new tool implementations here.
_TOOL_REGISTRY: dict[str, Any] = {}


def execute_tool(
    tool_name: str,
    arguments: dict[str, Any],
    *,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Dispatch and execute a tool by name, returning structured results.

    Routes the tool call to the appropriate implementation function based
    on the tool name. Currently supports:
    - "search_knowledge_base": RAG search over S3 documents

    Args:
        tool_name: Name of the tool to execute.
        arguments: Tool-specific arguments as key-value pairs.
        correlation_id: Request correlation identifier for logging.

    Returns:
        Dict with keys:
        - toolName: Name of the executed tool.
        - status: "success" or "error".
        - result: Tool output (structure depends on tool) on success.
        - error: Error description string on failure.
    """
    logger.info(
        "Executing tool",
        extra={
            "correlation_id": correlation_id,
            "toolName": tool_name,
            "arguments": arguments,
        },
    )

    try:
        if tool_name == "search_knowledge_base":
            result = search_knowledge_base(
                query=arguments.get("query", ""),
                correlation_id=correlation_id,
            )
            return {
                "toolName": tool_name,
                "status": "success",
                "result": result,
            }

        # Check the dynamic tool registry for additional tools
        if tool_name in _TOOL_REGISTRY:
            handler = _TOOL_REGISTRY[tool_name]
            result = handler(arguments, correlation_id=correlation_id)
            return {
                "toolName": tool_name,
                "status": "success",
                "result": result,
            }

        logger.warning(
            "Unknown tool requested",
            extra={
                "correlation_id": correlation_id,
                "toolName": tool_name,
            },
        )
        return {
            "toolName": tool_name,
            "status": "error",
            "error": f"Unknown tool: {tool_name}",
        }

    except Exception as e:
        logger.error(
            "Tool execution failed",
            extra={
                "correlation_id": correlation_id,
                "toolName": tool_name,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        return {
            "toolName": tool_name,
            "status": "error",
            "error": f"Tool execution failed: {type(e).__name__}: {e}",
        }


def search_knowledge_base(
    query: str,
    *,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Search the RAG knowledge base in S3 by key prefix.

    This is a placeholder RAG implementation that performs a simple S3
    prefix-based object lookup. It retrieves documents whose keys match
    the query prefix and returns their contents.

    Args:
        query: Search query string used as S3 key prefix.
        correlation_id: Request correlation identifier for logging.

    Returns:
        Dict with keys:
        - query: Original query string.
        - documents: List of matched document dicts, each containing
          "key" and "content" fields.
        - totalFound: Number of documents returned.

    Raises:
        RuntimeError: If the S3 operation fails with a non-retriable error.
    """
    logger.info(
        "Searching knowledge base",
        extra={
            "correlation_id": correlation_id,
            "query": query,
            "bucket": RAG_BUCKET_NAME,
        },
    )

    if not RAG_BUCKET_NAME:
        logger.error(
            "RAG_BUCKET_NAME not configured",
            extra={"correlation_id": correlation_id},
        )
        return {
            "query": query,
            "documents": [],
            "totalFound": 0,
        }

    if not query:
        return {
            "query": query,
            "documents": [],
            "totalFound": 0,
        }

    documents: list[dict[str, str]] = []

    try:
        client = _get_s3_client()
        list_response = client.list_objects_v2(
            Bucket=RAG_BUCKET_NAME,
            Prefix=query,
            MaxKeys=10,
        )

        for obj in list_response.get("Contents", []):
            key = obj["Key"]
            try:
                get_response = client.get_object(
                    Bucket=RAG_BUCKET_NAME,
                    Key=key,
                )
                content = get_response["Body"].read().decode("utf-8")
                documents.append({"key": key, "content": content})
            except ClientError as e:
                logger.warning(
                    "Failed to read document from S3",
                    extra={
                        "correlation_id": correlation_id,
                        "key": key,
                        "errorCode": e.response["Error"]["Code"],
                    },
                )
                continue

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        logger.error(
            "S3 list operation failed",
            extra={
                "correlation_id": correlation_id,
                "bucket": RAG_BUCKET_NAME,
                "errorCode": error_code,
                "errorMessage": e.response["Error"]["Message"],
            },
        )
        raise RuntimeError(
            f"Knowledge base search failed: {error_code}: {e.response['Error']['Message']}"
        ) from e

    logger.info(
        "Knowledge base search completed",
        extra={
            "correlation_id": correlation_id,
            "query": query,
            "totalFound": len(documents),
        },
    )

    return {
        "query": query,
        "documents": documents,
        "totalFound": len(documents),
    }


def register_tool(tool_name: str, handler: Any) -> None:
    """Register a custom tool handler in the tool registry.

    Allows extending the tool executor with additional tools beyond
    the built-in search_knowledge_base. Registered handlers must accept
    (arguments: dict, *, correlation_id: str) and return a result dict.

    Args:
        tool_name: Unique name for the tool.
        handler: Callable that executes the tool logic.
    """
    _TOOL_REGISTRY[tool_name] = handler
    logger.info("Tool registered", extra={"toolName": tool_name})
