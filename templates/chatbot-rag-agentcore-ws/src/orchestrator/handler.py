"""Lambda handler for the Orchestrator — WebSocket API Gateway direct integration.

Receives user messages directly from the WebSocket API Gateway sendMessage route,
invokes the AI Caller (AgentCore), and sends the complete response back to the
client via the WebSocket connection.

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
from shared.conversation_context import append_messages
from shared.message_protocol import build_error_message, build_message_response
from shared.message_sender import send_to_connection

logger = Logger(service="orchestrator")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """WebSocket sendMessage route handler (direct integration).

    Event structure from WebSocket API Gateway:
    {
        "requestContext": {"connectionId": "abc123", "routeKey": "sendMessage", "requestId": "..."},
        "body": "{\"message\": \"Hello\", \"userId\": \"user-123\"}"
    }

    Flow:
    1. Parse userId, message, and connectionId from the WebSocket event
    2. Invoke AgentCore AI caller (non-streaming) with the current message only
    3. Send the complete response to the client via WebSocket
    4. Save the conversation exchange to history for compliance

    Args:
        event: WebSocket API Gateway event with requestContext and body.
        context: Lambda execution context.

    Returns:
        Dict with statusCode 200 for API Gateway integration response.
    """
    body = json.loads(event.get("body", "{}"))
    connection_id = event["requestContext"]["connectionId"]
    user_id = body.get("userId", "")
    message_text = body.get("message", "")
    correlation_id = event["requestContext"].get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Processing message",
        extra={"userId": user_id, "messageLength": len(message_text)},
    )

    if not user_id or not message_text:
        logger.warning("Invalid message — missing userId or message")
        error_msg = build_error_message(
            "Invalid request — missing userId or message", correlation_id
        )
        send_to_connection(connection_id, error_msg)
        return {"statusCode": 200}

    # Invoke AgentCore (non-streaming — waits for complete response)
    try:
        result = invoke_agentcore(
            session_id=user_id,
            message=message_text,
            correlation_id=correlation_id,
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
        return {"statusCode": 200}

    # Send the complete response as a single "message" type (non-streaming)
    response_msg = build_message_response(ai_response, user_id)
    delivered = send_to_connection(connection_id, response_msg)

    if not delivered:
        logger.warning(
            "Failed to deliver response — connection may be stale",
            extra={"connectionId": connection_id, "userId": user_id},
        )

    # Save conversation exchange to history for compliance
    try:
        append_messages(
            user_id=user_id,
            user_message=message_text,
            assistant_response=ai_response,
            correlation_id=correlation_id,
        )
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
        # Non-blocking — response already delivered to client

    logger.info(
        "Message processing completed",
        extra={
            "userId": user_id,
            "responseLength": len(ai_response),
            "delivered": delivered,
        },
    )

    return {"statusCode": 200}
