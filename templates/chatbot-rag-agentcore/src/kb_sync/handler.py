"""KB Sync Lambda — triggers Bedrock Knowledge Base ingestion on S3 events."""

import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from shared.logging_config import get_logger

logger = get_logger("kb_sync")

KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")

bedrock_client = boto3.client("bedrock-agent")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # context: LambdaContext (no typed stub)
    """S3 event trigger handler — starts KB ingestion job."""
    records = event.get("Records", [])
    logger.info(
        "KB Sync triggered",
        extra={"eventRecordCount": len(records)},
    )

    try:
        response: Any = bedrock_client.start_ingestion_job(  # boto3 response (no typed stub)
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
        )

        ingestion_job = response.get("ingestionJob", {})
        job_id = ingestion_job.get("ingestionJobId", "unknown")

        logger.info(
            "Ingestion job started",
            extra={"ingestionJobId": job_id},
        )

        return {
            "success": True,
            "ingestionJobId": job_id,
        }

    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        error_message = exc.response.get("Error", {}).get("Message", str(exc))

        if error_code == "ConflictException":
            logger.info(
                "Ingestion job already running — skipping",
                extra={"errorCode": error_code, "errorMessage": error_message},
            )
            return {
                "success": True,
                "skipped": True,
                "reason": "concurrent_job",
            }

        logger.error(
            "StartIngestionJob failed",
            extra={"errorCode": error_code, "errorMessage": error_message},
        )
        raise

    except Exception as exc:
        logger.error(
            "Unexpected error in KB Sync",
            extra={"errorType": type(exc).__name__, "errorMessage": str(exc)},
        )
        raise
