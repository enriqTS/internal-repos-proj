"""Tool Executor Lambda — executes tool calls (RAG search)."""

import json
import os
import time
import traceback

import boto3
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.logging_config import get_logger

logger = get_logger("tool_executor")
metrics = Metrics(namespace="ChatbotRAG", service="tool-executor")

RAG_BUCKET = os.environ["RAG_BUCKET_NAME"]

s3_client = boto3.client("s3")


@metrics.log_metrics(capture_cold_start_metric=True)
@logger.inject_lambda_context
def handler(event, context):
    """Execute the requested tool and return results.

    Receives a tool call request with tool_name, arguments, and correlationId.
    Routes to the appropriate tool function and returns structured results.
    """
    start_time = time.time()
    correlation_id = event.get("correlationId", "unknown")
    logger.set_correlation_id(correlation_id)

    logger.info(
        "Tool executor invoked",
        extra={
            "correlationId": correlation_id,
            "tool_name": event.get("tool_name"),
        },
    )

    try:
        tool_name = event.get("tool_name")
        arguments = event.get("arguments", {})

        # TODO: Add additional tool routing here as you implement more tools.
        # Map tool names to their corresponding handler functions.
        tool_registry = {
            "search_knowledge_base": search_knowledge_base,
        }

        if tool_name not in tool_registry:
            raise ValueError(f"Unknown tool: {tool_name}")

        result = tool_registry[tool_name](**arguments)

        duration_ms = int((time.time() - start_time) * 1000)
        metrics.add_metric(name="ToolExecutionLatency", unit=MetricUnit.Milliseconds, value=duration_ms)
        logger.info(
            "Tool execution completed",
            extra={
                "correlationId": correlation_id,
                "tool_name": tool_name,
                "durationMs": duration_ms,
                "status": "success",
            },
        )

        return {
            "status": "success",
            "tool_name": tool_name,
            "result": result,
            "correlationId": correlation_id,
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Tool execution failed",
            extra={
                "correlationId": correlation_id,
                "tool_name": event.get("tool_name"),
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "stackTrace": traceback.format_exc(),
                "durationMs": duration_ms,
                "status": "failure",
            },
        )

        return {
            "status": "error",
            "tool_name": event.get("tool_name"),
            "error": str(e),
            "errorType": type(e).__name__,
            "correlationId": correlation_id,
        }


def search_knowledge_base(query: str) -> str:
    """
    Placeholder tool: searches the RAG bucket by key prefix.

    Accepts a query string and uses it as a key prefix to find matching
    objects in the RAG S3 bucket. Returns the content of matching objects.

    TODO: Replace this section with your document retrieval logic.
    Currently reads objects matching the query as a key prefix.
    Consider adding:
      - Vector similarity search (e.g., using embeddings and a vector store)
      - Document chunking for large files
      - Relevance filtering and scoring
      - Response formatting (summarization, citation, etc.)
    """
    # TODO: Customize the key prefix strategy for your knowledge base structure.
    # Currently uses the raw query as the S3 key prefix.
    prefix = query.strip()

    # TODO: Implement pagination if your knowledge base has many matching objects.
    response = s3_client.list_objects_v2(
        Bucket=RAG_BUCKET,
        Prefix=prefix,
        MaxKeys=5,
    )

    if "Contents" not in response or len(response["Contents"]) == 0:
        return f"No documents found matching query: {query}"

    # TODO: Add relevance filtering here to rank and select the most relevant documents.
    results = []
    for obj in response["Contents"]:
        key = obj["Key"]
        obj_response = s3_client.get_object(Bucket=RAG_BUCKET, Key=key)
        content = obj_response["Body"].read().decode("utf-8")
        results.append(f"--- {key} ---\n{content}")

    # TODO: Customize response formatting — consider summarization,
    # truncation, or structured output depending on your use case.
    return "\n\n".join(results)
