"""Connection lifecycle management for ECS WebSocket variant.

Manages connection entries in the DynamoDB Connection_Table. Stores
connectionId → userId mappings with TTL for automatic cleanup of stale
connections (24h default).

Configuration via environment variables:
- CONNECTION_TABLE_NAME: Name of the DynamoDB connections table
- CONNECTION_TTL_SECONDS: TTL duration in seconds (default: 86400 = 24h)
"""

import os
import time
from typing import Any

import boto3
from aws_lambda_powertools import Logger

logger = Logger(service="connection_manager")

# Configuration from environment variables
CONNECTION_TABLE_NAME: str = os.environ.get("CONNECTION_TABLE_NAME", "")
CONNECTION_TTL_SECONDS: int = int(os.environ.get("CONNECTION_TTL_SECONDS", "86400"))

# boto3 DynamoDB resource at module level for connection reuse across invocations.
# Lazy initialization to allow import without valid AWS credentials (testing).
_dynamodb_resource: Any = None
_table: Any = None


def _get_table() -> Any:  # noqa: ANN401
    """Get or create the DynamoDB table resource (lazy singleton).

    Returns None if CONNECTION_TABLE_NAME is not configured.
    """
    global _dynamodb_resource, _table  # noqa: PLW0603
    if not CONNECTION_TABLE_NAME:
        return None
    if _table is None:
        _dynamodb_resource = boto3.resource("dynamodb")
        _table = _dynamodb_resource.Table(CONNECTION_TABLE_NAME)
    return _table


def store_connection(connection_id: str, user_id: str) -> None:
    """Store a WebSocket connection mapping with TTL in the Connection_Table.

    On success, the entry will have:
    - connectionId: API Gateway WebSocket connection ID (partition key)
    - userId: user identifier (GSI partition key for reverse lookup)
    - connectedAt: Unix epoch seconds of connection time
    - expiresAt: connectedAt + CONNECTION_TTL_SECONDS (DynamoDB TTL attribute)

    On failure, logs at ERROR level and raises the exception so the $connect
    handler can reject the WebSocket connection by returning a non-success response.

    Args:
        connection_id: API Gateway WebSocket connection ID.
        user_id: User identifier for reverse lookup via GSI.

    Raises:
        RuntimeError: If CONNECTION_TABLE_NAME is not configured.
        Exception: If DynamoDB PutItem fails (connection should be rejected).
    """
    table = _get_table()
    if table is None:
        logger.error(
            "CONNECTION_TABLE_NAME not configured — cannot store connection",
            extra={"connectionId": connection_id, "userId": user_id},
        )
        raise RuntimeError("CONNECTION_TABLE_NAME not configured")

    now = int(time.time())
    try:
        table.put_item(
            Item={
                "connectionId": connection_id,
                "userId": user_id,
                "connectedAt": now,
                "expiresAt": now + CONNECTION_TTL_SECONDS,
            }
        )
        logger.info(
            "Stored WebSocket connection",
            extra={
                "connectionId": connection_id,
                "userId": user_id,
                "connectedAt": now,
                "expiresAt": now + CONNECTION_TTL_SECONDS,
            },
        )
    except Exception as e:
        logger.error(
            "Failed to store connection — rejecting WebSocket connection",
            extra={
                "connectionId": connection_id,
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        raise


def remove_connection(connection_id: str) -> None:
    """Remove a connection entry from the Connection_Table.

    On failure, logs at WARN level and does not retry. DynamoDB TTL will
    automatically remove the entry within 48 hours as a safety net.

    Args:
        connection_id: API Gateway WebSocket connection ID to remove.
    """
    table = _get_table()
    if table is None:
        logger.warning(
            "CONNECTION_TABLE_NAME not configured — cannot remove connection",
            extra={"connectionId": connection_id},
        )
        return

    try:
        table.delete_item(Key={"connectionId": connection_id})
        logger.info(
            "Removed WebSocket connection",
            extra={"connectionId": connection_id},
        )
    except Exception as e:
        logger.warning(
            "Failed to remove connection — relying on TTL expiration",
            extra={
                "connectionId": connection_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )


def get_connection_for_user(user_id: str) -> str | None:
    """Look up the active connection ID for a user via the userId-index GSI.

    Queries the GSI to find connections for the given user, filters out
    expired ones, and returns the most recently connected active connection.

    Args:
        user_id: User identifier to look up.

    Returns:
        The connectionId string if an active connection exists, or None if
        no connection is found, all are expired, or a query error occurs.
    """
    table = _get_table()
    if table is None:
        logger.error(
            "CONNECTION_TABLE_NAME not configured — cannot look up connection",
            extra={"userId": user_id},
        )
        return None

    try:
        response = table.query(
            IndexName="userId-index",
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        )
    except Exception as e:
        logger.error(
            "Failed to look up connection for user",
            extra={
                "userId": user_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        return None

    items = response.get("Items", [])
    if not items:
        logger.info(
            "No connections found for user",
            extra={"userId": user_id},
        )
        return None

    # Filter out expired connections
    now = int(time.time())
    active_items = [item for item in items if item.get("expiresAt", 0) > now]

    if not active_items:
        logger.info(
            "All connections for user are expired",
            extra={"userId": user_id, "expiredCount": len(items)},
        )
        return None

    # Return the most recently connected (highest connectedAt)
    active_items.sort(key=lambda x: x.get("connectedAt", 0), reverse=True)
    connection_id: str = active_items[0]["connectionId"]

    logger.info(
        "Found active connection for user",
        extra={"userId": user_id, "connectionId": connection_id},
    )
    return connection_id


def get_connection_item(connection_id: str) -> dict[str, Any] | None:
    """Get the full connection record by connection ID.

    Used by message_sender to check expiresAt before delivery attempt.

    Args:
        connection_id: API Gateway WebSocket connection ID.

    Returns:
        Connection item dict if found, None otherwise.
    """
    table = _get_table()
    if table is None:
        return None

    try:
        response = table.get_item(Key={"connectionId": connection_id})
        return response.get("Item")
    except Exception as e:
        logger.warning(
            "Failed to get connection item",
            extra={
                "connectionId": connection_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        return None
