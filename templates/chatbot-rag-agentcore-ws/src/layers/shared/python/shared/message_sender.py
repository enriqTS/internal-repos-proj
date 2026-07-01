"""Sends messages to WebSocket clients via API Gateway Management API.

Handles retry logic for transient errors, stale connection detection
(410 Gone), and expired connection cleanup (expiresAt < now).

Used by both Lambda and ECS WebSocket template variants for delivering
AI responses, streaming chunks, and status messages to connected clients.
"""

import json
import os
import time

import boto3
from botocore.exceptions import ClientError

from shared.connection_manager import get_connection_item, remove_connection
from shared.logging_config import get_logger

logger = get_logger("message_sender")

WEBSOCKET_API_ENDPOINT: str = os.environ.get("WEBSOCKET_API_ENDPOINT", "")

MAX_RETRIES: int = 3
BACKOFF_BASE: float = 0.5  # seconds


def _get_apigw_client():  # noqa: ANN202
    """Create API Gateway Management API client.

    Returns:
        boto3 client for apigatewaymanagementapi with configured endpoint.

    Raises:
        RuntimeError: If WEBSOCKET_API_ENDPOINT is not configured.
    """
    if not WEBSOCKET_API_ENDPOINT:
        raise RuntimeError("WEBSOCKET_API_ENDPOINT not configured")

    return boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=WEBSOCKET_API_ENDPOINT,
    )


def _is_connection_expired(connection_id: str) -> bool:
    """Check if a connection has expired based on its expiresAt value.

    Queries the Connection_Table for the connection record and checks
    if expiresAt is in the past. If expired, deletes the entry.

    Args:
        connection_id: API Gateway WebSocket connection ID.

    Returns:
        True if the connection is expired (or not found), False otherwise.
    """
    item = get_connection_item(connection_id)
    if item is None:
        # Connection not found in table — treat as not expired
        # (it may be a new connection not yet stored, or table issue)
        return False

    now = int(time.time())
    expires_at = item.get("expiresAt", 0)

    if expires_at < now:
        logger.info(
            "Connection expired — skipping delivery and cleaning up",
            extra={
                "connectionId": connection_id,
                "expiresAt": expires_at,
                "now": now,
            },
        )
        remove_connection(connection_id)
        return True

    return False


def send_to_connection(connection_id: str, message: dict) -> bool:
    """Send a JSON message to a WebSocket client.

    Handles:
    - Expired connections (expiresAt < now): skips delivery, deletes entry, returns False
    - 410 Gone: removes stale connection from Connection_Table, returns False
    - Transient errors: retries up to MAX_RETRIES with exponential backoff (base 0.5s)

    Args:
        connection_id: API Gateway WebSocket connection ID.
        message: Dictionary to serialize as JSON and send.

    Returns:
        True if message was delivered successfully, False on failure.
    """
    # Check for expired connection before attempting delivery
    if _is_connection_expired(connection_id):
        return False

    try:
        client = _get_apigw_client()
    except RuntimeError:
        logger.error(
            "Cannot send message — WEBSOCKET_API_ENDPOINT not configured",
            extra={"connectionId": connection_id},
        )
        return False

    payload = json.dumps(message).encode("utf-8")

    for attempt in range(MAX_RETRIES):
        try:
            client.post_to_connection(
                ConnectionId=connection_id,
                Data=payload,
            )
            return True

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "GoneException":
                logger.warning(
                    "Stale connection detected (410 Gone)",
                    extra={"connectionId": connection_id},
                )
                remove_connection(connection_id)
                return False

            # Transient error — retry with exponential backoff
            if attempt < MAX_RETRIES - 1:
                backoff = BACKOFF_BASE * (2**attempt)
                logger.warning(
                    "Transient send error — retrying",
                    extra={
                        "connectionId": connection_id,
                        "attempt": attempt + 1,
                        "maxRetries": MAX_RETRIES,
                        "backoffSeconds": backoff,
                        "errorCode": error_code,
                    },
                )
                time.sleep(backoff)
            else:
                logger.error(
                    "Send failed after all retries exhausted",
                    extra={
                        "connectionId": connection_id,
                        "attempts": MAX_RETRIES,
                        "errorCode": error_code,
                        "error": str(e),
                    },
                )
                return False

        except Exception as e:
            # Unexpected non-ClientError exception
            logger.error(
                "Unexpected error sending message",
                extra={
                    "connectionId": connection_id,
                    "error": str(e),
                },
                exc_info=True,
            )
            return False

    return False
