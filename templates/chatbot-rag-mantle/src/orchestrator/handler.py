"""Orchestrator Lambda — manages conversation flow and coordinates AI calls."""

import json
import os
import time
from typing import Any

import boto3
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.logging_config import get_logger

logger = get_logger("orchestrator")
metrics = Metrics(namespace="ChatbotRAG", service="orchestrator")

# Configuration from environment variables
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
MAX_TOOL_ITERATIONS = int(os.environ.get("MAX_TOOL_ITERATIONS", "10"))
AI_CALLER_FUNCTION_NAME = os.environ.get("AI_CALLER_FUNCTION_NAME", "")
TOOL_EXECUTOR_FUNCTION_NAME = os.environ.get("TOOL_EXECUTOR_FUNCTION_NAME", "")
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "")
RESPONSES_TABLE_NAME = os.environ.get("RESPONSES_TABLE_NAME", "")

# AWS clients
lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE_NAME) if DYNAMODB_TABLE_NAME else None
responses_table = dynamodb.Table(RESPONSES_TABLE_NAME) if RESPONSES_TABLE_NAME else None


# --- Utility helpers ---

BACKOFF_BASE = 2  # seconds


def _retry_with_backoff(func: Any, *args: Any, correlation_id: str = "", **kwargs: Any) -> tuple[bool, Any]:
    """Retry a callable with exponential backoff. Returns (success, result_or_error)."""
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            result = func(*args, **kwargs)
            return True, result
        except Exception as e:
            last_error = e
            backoff = BACKOFF_BASE**attempt
            logger.warning(
                "Retry attempt",
                extra={
                    "correlationId": correlation_id,
                    "attempt": attempt,
                    "maxAttempts": MAX_RETRY_ATTEMPTS,
                    "errorType": type(e).__name__,
                    "errorMessage": str(e),
                    "backoffSeconds": backoff,
                },
            )
            if attempt < MAX_RETRY_ATTEMPTS:
                time.sleep(backoff)
    return False, last_error


def _write_response(message_id: str, status: str, response: str = "", error: str = "", user_id: str = "") -> None:
    """Write processing result to the Responses Table."""
    if not responses_table:
        logger.warning("RESPONSES_TABLE_NAME not configured — skipping response write")
        return

    now = int(time.time())
    expires_at = now + 604800  # 7 days

    try:
        responses_table.put_item(
            Item={
                "messageId": message_id,
                "status": status,
                "response": response,
                "error": error,
                "userId": user_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "expiresAt": expires_at,
            }
        )
        logger.info(
            "Response written",
            extra={"messageId": message_id, "status": status},
        )
    except Exception as e:
        logger.error(
            "Failed to write response",
            extra={
                "messageId": message_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )


@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: Any) -> dict[str, int]:  # context: LambdaContext (no typed stub)
    """SQS trigger handler — processes one message at a time (batch size 1)."""
    start_time = time.time()

    record = event["Records"][0]
    body = json.loads(record["body"])

    user_id = body.get("userId", "")
    message = body.get("message", "")
    message_id = body.get("messageId", context.aws_request_id)
    correlation_id = body.get("correlationId", context.aws_request_id)
    timestamp = body.get("timestamp", "")

    logger.set_correlation_id(correlation_id)
    logger.info(
        "Orchestrator invoked",
        extra={
            "correlationId": correlation_id,
            "userId": user_id,
            "messageId": message_id,
        },
    )

    # Write pending status immediately
    _write_response(message_id, status="pending", user_id=user_id)

    try:
        response_text = _process_message(user_id, message, correlation_id, timestamp)
        duration_ms = int((time.time() - start_time) * 1000)

        # Write completed response
        _write_response(message_id, status="completed", response=response_text, user_id=user_id)

        metrics.add_metric(name="MessageProcessingLatency", unit=MetricUnit.Milliseconds, value=duration_ms)

        logger.info(
            "Processing completed successfully",
            extra={
                "correlationId": correlation_id,
                "status": "success",
                "durationMs": duration_ms,
            },
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        # Write failed response — DO NOT re-raise
        _write_response(message_id, status="failed", error=str(e), user_id=user_id)

        logger.error(
            "Processing failed — all retries exhausted",
            extra={
                "correlationId": correlation_id,
                "status": "failure",
                "durationMs": duration_ms,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "userId": user_id,
                "messageId": message_id,
            },
        )

    # Always return success so SQS deletes the message
    return {"statusCode": 200}


def _process_message(user_id: str, message: str, correlation_id: str, timestamp: str) -> str:
    """Core processing logic: retrieve history, invoke AI, handle tool loop, save.

    Returns the final response text on success. Raises on unrecoverable failure.
    """
    # Step 1: Retrieve conversation history
    conversation_history = retrieve_conversation_history(user_id, correlation_id)

    # Step 2: Append new user message
    user_message = {
        "role": "user",
        "content": message,
        "timestamp": timestamp,
    }
    conversation_history.append(user_message)

    # Step 3: Tool-use loop
    messages_for_ai = list(conversation_history)
    final_response = None

    for iteration in range(MAX_TOOL_ITERATIONS):
        logger.info(
            "Invoking AI Caller",
            extra={
                "correlationId": correlation_id,
                "iteration": iteration + 1,
                "maxIterations": MAX_TOOL_ITERATIONS,
            },
        )

        # Use retry with backoff for AI Caller invocation
        success, result = _retry_with_backoff(
            invoke_ai_caller,
            messages=messages_for_ai,
            correlation_id=correlation_id,
        )

        if not success:
            raise RuntimeError(f"AI Caller invocation failed after {MAX_RETRY_ATTEMPTS} attempts: {result}")

        ai_response = result
        function_calls = ai_response.get("function_calls", [])

        if not function_calls:
            # No tool calls — we have a final text response
            final_response = ai_response
            break

        # Tool calls present — invoke Tool Executor for each
        logger.info(
            "Tool calls requested",
            extra={
                "correlationId": correlation_id,
                "iteration": iteration + 1,
                "toolCallCount": len(function_calls),
                "toolNames": [fc.get("name", "") for fc in function_calls],
            },
        )

        tool_results = invoke_tool_executor(function_calls, correlation_id)

        # Append assistant message with tool calls and tool results to conversation
        assistant_message = {
            "role": "assistant",
            "content": ai_response.get("content", ""),
            "tool_calls": function_calls,
        }
        messages_for_ai.append(assistant_message)

        # Append tool results as tool messages
        for result in tool_results:
            tool_message = {
                "role": "tool",
                "content": json.dumps(result.get("result", "")),
                "tool_call_id": result.get("tool_call_id", ""),
            }
            messages_for_ai.append(tool_message)
    else:
        # Max iterations reached without a text-only response
        raise RuntimeError(f"Conversation exceeded maximum allowed tool-use iterations ({MAX_TOOL_ITERATIONS}).")

    # Step 4: Append assistant response to history
    assistant_response_message = {
        "role": "assistant",
        "content": final_response.get("content", ""),
        "timestamp": final_response.get("timestamp", ""),
    }
    conversation_history.append(assistant_response_message)

    # Step 5: Save updated conversation history
    save_conversation_history(user_id, conversation_history, correlation_id)

    # Step 6: Return final response text
    return final_response.get("content", "")


def retrieve_conversation_history(user_id: str, correlation_id: str) -> list[dict[str, Any]]:
    """
    Retrieve conversation history from DynamoDB, trimmed to max length.

    On failure, proceeds with empty history and logs ERROR.
    """
    try:
        response = table.get_item(Key={"userId": user_id})
        item = response.get("Item", {})
        messages = item.get("messages", [])

        # Trim to MAX_CONVERSATION_HISTORY (oldest first, keep most recent)
        if len(messages) > MAX_CONVERSATION_HISTORY:
            messages = messages[-MAX_CONVERSATION_HISTORY:]

        logger.info(
            "Retrieved conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "messageCount": len(messages),
            },
        )
        return messages

    except Exception as e:
        logger.error(
            "Failed to retrieve conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        # Proceed with empty history on DynamoDB read failure
        return []


def save_conversation_history(user_id: str, messages: list[dict[str, Any]], correlation_id: str) -> None:
    """
    Save updated conversation history to DynamoDB.

    On failure, logs ERROR but does not raise — the response is still returned.
    """
    try:
        table.put_item(
            Item={
                "userId": user_id,
                "messages": messages,
            }
        )
        logger.info(
            "Saved conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "messageCount": len(messages),
            },
        )
    except Exception as e:
        logger.error(
            "Failed to save conversation history",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )


def invoke_ai_caller(messages: list[dict[str, Any]], correlation_id: str) -> dict[str, Any]:
    """Synchronously invoke the AI Caller Lambda."""
    payload = {
        "messages": messages,
        "correlationId": correlation_id,
    }

    response = lambda_client.invoke(
        FunctionName=AI_CALLER_FUNCTION_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload),
    )

    response_payload = json.loads(response["Payload"].read())

    if "FunctionError" in response:
        raise RuntimeError(f"AI Caller invocation failed: {response_payload}")

    return response_payload


def invoke_tool_executor(tool_calls: list[dict[str, Any]], correlation_id: str) -> list[dict[str, Any]]:
    """Invoke the Tool Executor Lambda for each tool call and collect results."""
    results = []

    for tool_call in tool_calls:
        payload = {
            "toolCall": tool_call,
            "correlationId": correlation_id,
        }

        response = lambda_client.invoke(
            FunctionName=TOOL_EXECUTOR_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )

        response_payload = json.loads(response["Payload"].read())

        if "FunctionError" in response:
            logger.error(
                "Tool Executor invocation failed",
                extra={
                    "correlationId": correlation_id,
                    "toolName": tool_call.get("name", ""),
                    "error": response_payload,
                },
            )
            results.append(
                {
                    "tool_call_id": tool_call.get("call_id", ""),
                    "result": {"error": str(response_payload)},
                }
            )
        else:
            results.append(
                {
                    "tool_call_id": tool_call.get("call_id", ""),
                    "result": response_payload,
                }
            )

    return results
