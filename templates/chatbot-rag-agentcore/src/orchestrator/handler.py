"""Orchestrator Lambda — manages conversation flow and coordinates AI calls.

AgentCore variant: The AgentCore Runtime manages tool calling internally.
This orchestrator simply invokes the AI Caller and receives the final response
back — no tool-use iteration loop is needed.
"""

import json
import os
import time

import boto3

from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.logging_config import get_logger
from shared.models import ChatMessage

logger = get_logger("orchestrator")
metrics = Metrics(namespace="ChatbotRAG", service="orchestrator")

# Configuration from environment variables
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
AI_CALLER_FUNCTION_NAME = os.environ.get("AI_CALLER_FUNCTION_NAME", "")
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "")
RESPONSES_TABLE_NAME = os.environ.get("RESPONSES_TABLE_NAME", "")

# AWS clients
lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE_NAME) if DYNAMODB_TABLE_NAME else None
responses_table = dynamodb.Table(RESPONSES_TABLE_NAME) if RESPONSES_TABLE_NAME else None


# --- Utility helpers ---

BACKOFF_BASE = 2  # seconds


def _retry_with_backoff(func, *args, correlation_id="", **kwargs):
    """Retry a callable with exponential backoff. Returns (success, result_or_error)."""
    last_error = None
    for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
        try:
            result = func(*args, **kwargs)
            return True, result
        except Exception as e:
            last_error = e
            backoff = BACKOFF_BASE ** attempt
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


def _write_response(message_id, status, response="", error="", user_id=""):
    """Write processing result to the Responses Table."""
    if not responses_table:
        logger.warning("RESPONSES_TABLE_NAME not configured — skipping response write")
        return

    now = int(time.time())
    expires_at = now + 604800  # 7 days

    try:
        responses_table.put_item(Item={
            "messageId": message_id,
            "status": status,
            "response": response,
            "error": error,
            "userId": user_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "expiresAt": expires_at,
        })
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
def handler(event, context):
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


def _process_message(user_id, message, correlation_id, timestamp):
    """Core processing logic: retrieve history, invoke AI Caller, save response.

    Unlike the Mantle variant, no tool-use loop is needed here. The AgentCore
    Runtime handles tool calling internally — it invokes the Tool Executor Lambda
    directly as an action group. The AI Caller returns only the final response.
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

    # Step 3: Invoke AI Caller with retry (AgentCore Runtime handles tool calls internally)
    logger.info(
        "Invoking AI Caller",
        extra={
            "correlationId": correlation_id,
            "userId": user_id,
            "messageCount": len(conversation_history),
        },
    )

    success, result = _retry_with_backoff(
        invoke_ai_caller,
        messages=conversation_history,
        correlation_id=correlation_id,
    )

    if not success:
        raise RuntimeError(
            f"AI Caller invocation failed after {MAX_RETRY_ATTEMPTS} attempts: {result}"
        )

    ai_response = result

    # Step 4: Append assistant response to history
    assistant_response_message = {
        "role": "assistant",
        "content": ai_response.get("response", ai_response.get("content", "")),
        "timestamp": ai_response.get("timestamp", ""),
    }
    conversation_history.append(assistant_response_message)

    # Step 5: Save updated conversation history
    save_conversation_history(user_id, conversation_history, correlation_id)

    # Emit conversation length metric
    metrics.add_metric(name="ConversationLength", unit=MetricUnit.Count, value=len(conversation_history))

    # Step 6: Return final response text
    return ai_response.get("response", ai_response.get("content", ""))


def retrieve_conversation_history(user_id, correlation_id):
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


def save_conversation_history(user_id, messages, correlation_id):
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


def invoke_ai_caller(messages, correlation_id):
    """Synchronously invoke the AI Caller Lambda.

    The AI Caller invokes Bedrock AgentCore Runtime, which manages tool calls
    internally. The response returned here is always the final AI response.
    """
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
        raise RuntimeError(
            f"AI Caller invocation failed: {response_payload}"
        )

    return response_payload
