"""Orchestrator Lambda — manages conversation flow and coordinates AI calls.

AgentCore variant: The AgentCore Runtime manages tool calling internally.
This orchestrator simply invokes the AI Caller and receives the final response
back — no tool-use iteration loop is needed.
"""

import json
import os
import time

import boto3

from shared.logging_config import get_logger
from shared.models import ChatMessage

logger = get_logger("orchestrator")

# Configuration from environment variables
MAX_CONVERSATION_HISTORY = int(os.environ.get("MAX_CONVERSATION_HISTORY", "50"))
MAX_RETRY_ATTEMPTS = int(os.environ.get("MAX_RETRY_ATTEMPTS", "3"))
AI_CALLER_FUNCTION_NAME = os.environ.get("AI_CALLER_FUNCTION_NAME", "")
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "")

# AWS clients
lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE_NAME) if DYNAMODB_TABLE_NAME else None


@logger.inject_lambda_context
def handler(event, context):
    """SQS trigger handler — processes one message at a time (batch size 1)."""
    start_time = time.time()

    record = event["Records"][0]
    body = json.loads(record["body"])

    user_id = body.get("userId", "")
    message = body.get("message", "")
    correlation_id = body.get("correlationId", context.aws_request_id)
    timestamp = body.get("timestamp", "")

    logger.set_correlation_id(correlation_id)
    logger.info(
        "Orchestrator invoked",
        extra={
            "correlationId": correlation_id,
            "userId": user_id,
        },
    )

    try:
        response = _process_message(user_id, message, correlation_id, timestamp)
        duration_ms = int((time.time() - start_time) * 1000)
        logger.info(
            "Processing completed successfully",
            extra={
                "correlationId": correlation_id,
                "status": "success",
                "durationMs": duration_ms,
            },
        )
        return response

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.exception(
            "Processing failed",
            extra={
                "correlationId": correlation_id,
                "status": "failure",
                "durationMs": duration_ms,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "userId": user_id,
                "messageBody": message,
                "attempts": MAX_RETRY_ATTEMPTS,
            },
        )
        raise


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

    # Step 3: Invoke AI Caller (AgentCore Runtime handles tool calls internally)
    logger.info(
        "Invoking AI Caller",
        extra={
            "correlationId": correlation_id,
            "userId": user_id,
            "messageCount": len(conversation_history),
        },
    )

    ai_response = invoke_ai_caller(
        messages=conversation_history,
        correlation_id=correlation_id,
    )

    # Step 4: Append assistant response to history
    assistant_response_message = {
        "role": "assistant",
        "content": ai_response.get("content", ""),
        "timestamp": ai_response.get("timestamp", ""),
    }
    conversation_history.append(assistant_response_message)

    # Step 5: Save updated conversation history
    save_conversation_history(user_id, conversation_history, correlation_id)

    # Step 6: Return final response
    return {
        "statusCode": 200,
        "body": json.dumps({
            "response": ai_response.get("content", ""),
            "conversationId": user_id,
            "timestamp": timestamp,
            "correlationId": correlation_id,
        }),
    }


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
