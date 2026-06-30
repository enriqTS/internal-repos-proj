"""Tool Executor Lambda — executes tool calls (RAG search).

This Lambda is invoked DIRECTLY by AgentCore Runtime as an action group Lambda.
It receives events in the Bedrock Agent action group format and returns results
back to the AgentCore Runtime (not the orchestrator).
"""

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
    """Execute the requested tool and return results to AgentCore Runtime.

    Receives a Bedrock Agent action group event with:
      - actionGroup: the action group name
      - function: the function name to execute
      - parameters: list of {name, value} parameter objects
      - sessionId: the agent session identifier (used as correlation ID)
      - messageVersion: protocol version

    Returns a structured response in the Bedrock Agent action group format.
    """
    start_time = time.time()

    # Extract correlation ID from sessionId or fallback to request context
    session_id = event.get("sessionId", "unknown")
    correlation_id = session_id
    logger.set_correlation_id(correlation_id)

    action_group = event.get("actionGroup", "unknown")
    function_name = event.get("function", "unknown")

    logger.info(
        "Tool executor invoked by AgentCore Runtime",
        extra={
            "correlationId": correlation_id,
            "actionGroup": action_group,
            "function": function_name,
            "sessionId": session_id,
        },
    )

    try:
        # Parse parameters from the action group event format
        parameters = event.get("parameters", [])
        arguments = {param["name"]: param["value"] for param in parameters}

        # TODO: Add additional tool routing here as you implement more tools.
        # Map function names to their corresponding handler functions.
        tool_registry = {
            "search_knowledge_base": search_knowledge_base,
        }

        if function_name not in tool_registry:
            raise ValueError(f"Unknown function: {function_name}")

        result = tool_registry[function_name](**arguments)

        duration_ms = int((time.time() - start_time) * 1000)
        metrics.add_metric(name="ToolExecutionLatency", unit=MetricUnit.Milliseconds, value=duration_ms)
        logger.info(
            "Tool execution completed",
            extra={
                "correlationId": correlation_id,
                "actionGroup": action_group,
                "function": function_name,
                "durationMs": duration_ms,
                "status": "success",
            },
        )

        # Return response in Bedrock Agent action group format
        return {
            "messageVersion": "1.0",
            "response": {
                "actionGroup": action_group,
                "function": function_name,
                "functionResponse": {
                    "responseBody": {
                        "TEXT": {
                            "body": result,
                        }
                    }
                },
            },
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error(
            "Tool execution failed",
            extra={
                "correlationId": correlation_id,
                "actionGroup": action_group,
                "function": function_name,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "stackTrace": traceback.format_exc(),
                "durationMs": duration_ms,
                "status": "failure",
            },
        )

        # Return error in Bedrock Agent action group format
        return {
            "messageVersion": "1.0",
            "response": {
                "actionGroup": action_group,
                "function": function_name,
                "functionResponse": {
                    "responseBody": {
                        "TEXT": {
                            "body": f"Error executing {function_name}: {str(e)}",
                        }
                    }
                },
            },
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
