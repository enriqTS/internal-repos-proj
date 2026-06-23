"""Logging configuration using aws-lambda-powertools!"""

from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.logging import correlation_paths


def get_logger(service_name: str) -> Logger:
    """Create a Powertools Logger with structured JSON output and correlation ID support."""
    return Logger(service=service_name, log_uncaught_exceptions=True)


def get_tracer(service_name: str) -> Tracer:
    """Create a Powertools Tracer for X-Ray integration."""
    return Tracer(service=service_name)


def log_ai_interaction(logger: Logger, **kwargs) -> None:
    """
    Log an AI interaction entry with logType='ai-interaction'.

    Appends structured fields (model, tokens, latency, etc.) to the logger
    and emits an INFO-level log entry for AI-specific filtering.
    """
    logger.info(
        "AI interaction",
        extra={
            "logType": "ai-interaction",
            **kwargs
        }
    )
