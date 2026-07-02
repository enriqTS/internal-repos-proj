"""Orchestrator Lambda — manages conversation flow and coordinates AI calls.

AgentCore variant: The AgentCore Runtime manages conversation context
natively via sessionId. This orchestrator simply invokes the AI Caller
with the current user message and saves the exchange for compliance.
No conversation history retrieval is needed before AI invocation.
"""

import json
import os
import time
from typing import Any

import boto3
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.conversation_context import append_messages
from shared.logging_config import get_logger

logger = get_logger("orchestrator")
metrics = Metrics(namespace="ChatbotRAG", service="orchestrator")

# Configuration from environment variables
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
AI_CALLER_FUNCTION_NAME = os.environ.get("AI_CALLER_FUNCTION_NAME", "")
RESPONSES_TABLE_NAME = os.environ.get("RESPONSES_TABLE_NAME", "")

# AWS clients
lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")
responses_table = dynamodb.Table(RESPONSES_TABLE_NAME) if RESPONSES_TABLE_NAME else None


# --- Utility helpers ---

BACKOFF_BASE = 2  # seconds


def _retry_with_backoff(func: Any, *args: Any, _correlation_id: str = "", **kwargs: Any) -> tuple[bool, Any]:
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
                    "correlationId": _correlation_id,
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
    """Core processing logic: invoke AI Caller, save exchange for compliance.

    AgentCore Runtime manages conversation context natively via sessionId.
    No history retrieval is needed — the AI Caller receives only the current
    user message. After a successful response, the exchange is persisted to
    DynamoDB for compliance/audit via append_messages().
    """
    # Step 1: Invoke AI Caller with simplified payload (retry with backoff)
    logger.info(
        "Invoking AI Caller",
        extra={
            "correlationId": correlation_id,
            "userId": user_id,
        },
    )

    success, result = _retry_with_backoff(
        invoke_ai_caller,
        message=message,
        session_id=user_id,
        correlation_id=correlation_id,
        _correlation_id=correlation_id,
    )

    if not success:
        raise RuntimeError(f"AI Caller invocation failed after {MAX_RETRY_ATTEMPTS} attempts: {result}")

    ai_response = result
    response_text = ai_response.get("response", ai_response.get("content", ""))

    # Step 2: Save conversation exchange for compliance (non-blocking on failure)
    try:
        updated_messages = append_messages(
            user_id,
            message,
            response_text,
            correlation_id=correlation_id,
        )
        # Emit conversation length metric
        metrics.add_metric(name="ConversationLength", unit=MetricUnit.Count, value=len(updated_messages))
    except Exception as e:
        logger.error(
            "Failed to save conversation exchange",
            extra={
                "correlationId": correlation_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        # Non-blocking — AI response is still returned to user

    # Step 3: Return final response text
    return response_text


def invoke_ai_caller(message: str, session_id: str, correlation_id: str) -> dict[str, Any]:
    """Synchronously invoke the AI Caller Lambda with simplified payload.

    The AI Caller invokes Bedrock AgentCore Runtime, which manages tool calls
    and conversation context internally via sessionId. Only the current user
    message is sent — no conversation history array.
    """
    payload = {
        "message": message,
        "sessionId": session_id,
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
