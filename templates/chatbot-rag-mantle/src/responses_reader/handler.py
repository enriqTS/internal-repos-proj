"""Responses Reader Lambda — GET /responses/{messageId} handler."""

import json
import os
from typing import Any

import boto3
from shared.logging_config import get_logger

logger = get_logger("responses_reader")

RESPONSES_TABLE_NAME = os.environ.get("RESPONSES_TABLE_NAME", "")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(RESPONSES_TABLE_NAME) if RESPONSES_TABLE_NAME else None

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET",
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # context: LambdaContext (aws_lambda_powertools.utilities.typing)
    """API Gateway proxy handler for GET /responses/{messageId}."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    message_id: str = event.get("pathParameters", {}).get("messageId", "")

    if not message_id:
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json", **CORS_HEADERS},
            "body": json.dumps({"error": "bad_request", "message": "messageId path parameter is required"}),
        }

    try:
        result: Any = table.get_item(Key={"messageId": message_id})  # boto3 DynamoDB response type not available
    except Exception as e:
        logger.error("DynamoDB read failed", extra={"messageId": message_id, "error": str(e)})
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", **CORS_HEADERS},
            "body": json.dumps({"error": "internal_error", "message": "Failed to read response"}),
        }

    if "Item" not in result:
        return {
            "statusCode": 404,
            "headers": {"Content-Type": "application/json", **CORS_HEADERS},
            "body": json.dumps({"error": "not_found", "message": f"No response found for messageId: {message_id}"}),
        }

    record: dict[str, Any] = result["Item"]
    # Convert Decimal types to int for JSON serialization
    if "expiresAt" in record:
        record["expiresAt"] = int(record["expiresAt"])

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": json.dumps(record),
    }
