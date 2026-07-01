"""Lambda handler for WebSocket $connect and $disconnect events.

Routes API Gateway WebSocket lifecycle events to the shared connection
manager module. On $connect, extracts userId from queryStringParameters
and stores the connection. On $disconnect, removes the connection entry.

Environment variables:
- CONNECTION_TABLE_NAME: DynamoDB table for connection storage
- CONNECTION_TTL_SECONDS: TTL duration in seconds (default: 86400)
- POWERTOOLS_SERVICE_NAME: Service name for structured logging
- POWERTOOLS_LOG_LEVEL: Log level (default: INFO)
"""

import uuid
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from shared.connection_manager import remove_connection, store_connection

logger = Logger(service="connection_manager")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    """Handle WebSocket $connect and $disconnect events.

    Args:
        event: API Gateway WebSocket event with requestContext containing
            routeKey ($connect or $disconnect) and connectionId.
        context: Lambda execution context.

    Returns:
        API Gateway response dict with statusCode.
    """
    request_context = event.get("requestContext", {})
    route_key = request_context.get("routeKey", "")
    connection_id = request_context.get("connectionId", "")
    correlation_id = request_context.get("requestId", str(uuid.uuid4()))

    logger.append_keys(correlation_id=correlation_id)
    logger.info(
        "Connection event received",
        extra={
            "routeKey": route_key,
            "connectionId": connection_id,
        },
    )

    if route_key == "$connect":
        return _handle_connect(event, connection_id, correlation_id)
    elif route_key == "$disconnect":
        return _handle_disconnect(connection_id, correlation_id)
    else:
        logger.warning("Unexpected route key", extra={"routeKey": route_key})
        return {"statusCode": 400, "body": "Unsupported route"}


def _handle_connect(
    event: dict[str, Any],
    connection_id: str,
    correlation_id: str,
) -> dict[str, Any]:
    """Handle $connect: extract userId and store connection.

    userId is extracted from queryStringParameters. If not provided,
    the connection is rejected with a 400 response.

    Args:
        event: API Gateway WebSocket event.
        connection_id: WebSocket connection ID.
        correlation_id: Request correlation identifier.

    Returns:
        API Gateway response with statusCode 200 on success, 400/500 on failure.
    """
    query_params = event.get("queryStringParameters") or {}
    user_id = query_params.get("userId", "")

    if not user_id:
        logger.warning(
            "Connection rejected — missing userId in queryStringParameters",
            extra={"connectionId": connection_id},
        )
        return {"statusCode": 400, "body": "Missing userId parameter"}

    try:
        store_connection(connection_id, user_id)
        logger.info(
            "Connection accepted",
            extra={"connectionId": connection_id, "userId": user_id},
        )
        return {"statusCode": 200, "body": "Connected"}
    except Exception as e:
        logger.error(
            "Connection rejected — failed to store connection",
            extra={
                "connectionId": connection_id,
                "userId": user_id,
                "error": str(e),
            },
        )
        return {"statusCode": 500, "body": "Failed to establish connection"}


def _handle_disconnect(
    connection_id: str,
    correlation_id: str,
) -> dict[str, Any]:
    """Handle $disconnect: remove connection entry from Connection_Table.

    Removal failures are logged at WARN level but do not fail the response.
    TTL-based expiration provides a safety net for cleanup.

    Args:
        connection_id: WebSocket connection ID to remove.
        correlation_id: Request correlation identifier.

    Returns:
        API Gateway response with statusCode 200.
    """
    remove_connection(connection_id)
    logger.info(
        "Disconnect processed",
        extra={"connectionId": connection_id},
    )
    return {"statusCode": 200, "body": "Disconnected"}
