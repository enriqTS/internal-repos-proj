"""Logging configuration using aws-lambda-powertools.

Provides structured JSON logging consistent across all template variants
(Lambda and ECS). Uses POWERTOOLS_SERVICE_NAME and POWERTOOLS_LOG_LEVEL
environment variables for configuration.

Works outside Lambda environments (ECS, local dev) via Powertools Logger
which detects the runtime context automatically.
"""

from aws_lambda_powertools import Logger, Tracer


def get_logger(service_name: str) -> Logger:
    """Create a Powertools Logger with structured JSON output and correlation ID support.

    The Logger reads configuration from environment variables:
    - POWERTOOLS_SERVICE_NAME: overrides service_name if set
    - POWERTOOLS_LOG_LEVEL: sets log level (default: INFO)

    Structured output fields: timestamp, level, service, correlation_id, message,
    plus optional extra fields (logType, model, tokens, latencyMs).

    Args:
        service_name: Identifier for the component producing logs.

    Returns:
        Configured Logger instance with structured JSON output.
    """
    return Logger(service=service_name, log_uncaught_exceptions=True)


def get_tracer(service_name: str) -> Tracer:
    """Create a Powertools Tracer for X-Ray integration.

    Args:
        service_name: Identifier for the traced service segment.

    Returns:
        Configured Tracer instance.
    """
    return Tracer(service=service_name)


def log_ai_interaction(
    logger: Logger,
    *,
    correlation_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    latency_ms: float,
    finish_reason: str,
) -> None:
    """Log an AI interaction with logType='ai-interaction'.

    Emits a single structured INFO log entry after an AI service call completes.
    For streaming calls, this must be called once after the stream finishes,
    not per-chunk.

    Args:
        logger: Powertools Logger instance.
        correlation_id: Request correlation identifier.
        model: AI model identifier used for the call.
        input_tokens: Number of input tokens consumed.
        output_tokens: Number of output tokens generated.
        total_tokens: Total tokens (input + output).
        latency_ms: Total call latency in milliseconds.
        finish_reason: AI service finish reason (e.g., "stop", "tool_use").
    """
    logger.info(
        "AI interaction completed",
        extra={
            "logType": "ai-interaction",
            "correlation_id": correlation_id,
            "model": model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
            "latencyMs": latency_ms,
            "finishReason": finish_reason,
        },
    )
