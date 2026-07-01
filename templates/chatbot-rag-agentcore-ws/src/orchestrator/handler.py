"""Lambda handler for the Orchestrator — SQS-triggered message processing.

Receives user messages from the SQS FIFO queue, retrieves conversation history,
invokes the AI Caller (AgentCore), and sends the complete response back to the
client via the WebSocket Message Sender.

Non-streaming: waits for complete AI response, sends as single "message" type.

Environment variables:
- DYNAMODB_TABLE_NAME: DynamoDB table for user conversation context
- CONNECTION_TABLE_NAME: DynamoDB table for WebSocket connections
- WEBSOCKET_API_ENDPOINT: API Gateway Management API endpoint URL
- AGENT_RUNTIME_ARN: AgentCore runtime ARN
- AGENT_ALIAS_ID: Agent alias identifier
- AGENT_ID: Agent identifier
- MAX_CONVERSATION_HISTORY: Max messages retained (default: 50)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import json
import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.ai_caller_agentcore import invoke_agentcore
from shared.connection_manager import get_connection_for_user
from shared.conversation_context import append_messages, get_conversation_history
from shared.message_protocol import build_error_message, build_message_response
from shared.message_sender import send_to_connection

logger = Logger(service="orchestrator")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Process SQS messages containing user chat requests.

    Each SQS record contains a JSON body with userId and message fields.
    For each record:
    1. Parse and validate the message
    2. Retrieve conversation history
    3. Invoke AgentCore AI caller (non-streaming)
    4. Send the complete response to the client via WebSocket
    5. Save the conversation exchange to history

    Args:
        event: SQS event with Records list.
        context: Lambda execution context.

    Returns:
        Dict with batchItemFailures for partial batch failure handling.
    """
    batch_item_failures: list[dict[str, str]] = []

    for record in event.get("Records", []):
        message_id = record.get("messageId", "")
        try:
            _process_record(record)
        except Exception as e:
            logger.error(
                "Failed to process SQS record",
                extra={
                    "messageId": message_id,
                    "error": str(e),
                },
            )
            batch_item_failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": batch_item_failures}


def _process_record(record: dict[str, Any]) -> None:
    """Process a single SQS record containing a user message.

    Args:
        record: SQS record with body containing JSON chat message.

    Raises:
        Exception: Propagated from AI caller or critical failures.
    """
    body = json.loads(record.get("body", "{}"))
    user_id = body.get("userId", "")
    message_text = body.get("message", "")
    correlation_id = record.get("messageId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    if not user_id or not message_text:
        logger.warning("Invalid message — missing userId or message")
        return

    # Look up the active WebSocket connection for this user
    connection_id = get_connection_for_user(user_id)
    if not connection_id:
        logger.warning(
            "No active WebSocket connection for user — cannot deliver response",
            extra={"userId": user_id},
        )
        return

    # Retrieve conversation history (returns [] on failure — graceful degradation)
    history = get_conversation_history(user_id, correlation_id=correlation_id)

    # Build messages list for AI invocation
    messages = [*history, {"role": "user", "content": message_text}]

    # Invoke AgentCore (non-streaming — waits for complete response)
    try:
        result = invoke_agentcore(
            session_id=user_id,
            messages=messages,
            correlation_id=correlation_id,
            stream=False,
        )
        ai_response = result.get("response", "")
    except Exception as e:
        logger.error(
            "AI invocation failed",
            extra={
                "correlation_id": correlation_id,
                "error": str(e),
            },
        )
        # Send error message to client
        error_msg = build_error_message(
            "Processing failed — please retry", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        raise

    # Send the complete response as a single "message" type (non-streaming)
    response_msg = build_message_response(ai_response, user_id)
    delivered = send_to_connection(connection_id, response_msg)

    if not delivered:
        logger.warning(
            "Failed to deliver response — connection may be stale",
            extra={"connectionId": connection_id, "userId": user_id},
        )

    # Save conversation exchange to history
    append_messages(
        user_id=user_id,
        user_message=message_text,
        assistant_response=ai_response,
        correlation_id=correlation_id,
    )

    logger.info(
        "Message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(ai_response),
            "delivered": delivered,
        },
    )
