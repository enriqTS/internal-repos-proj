"""Shared AI Caller core logic — AgentCore variant.

Provides the core AI invocation logic for Bedrock AgentCore Runtime,
used by both Lambda and ECS template variants. Supports non-streaming
and streaming modes.

Configuration via environment variables:
- AGENT_RUNTIME_ARN: AgentCore runtime ARN
- AGENT_ALIAS_ID: Agent alias identifier (default: TSTALIASID)
- AGENT_ID: Agent identifier

This module is copied into each variant; the only permitted differences
between variants are the `stream` parameter and import paths.
"""

import os
import time
from collections.abc import Generator
from typing import Any

import boto3
from botocore.exceptions import ClientError

from shared.logging_config import get_logger, log_ai_interaction

logger = get_logger("ai_caller")

# PLACEHOLDER: Replace this system prompt with your own instructions.
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."

AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
AGENT_ALIAS_ID = os.environ.get("AGENT_ALIAS_ID", "TSTALIASID")
AGENT_ID = os.environ.get("AGENT_ID", "")

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")


def invoke_agentcore(
    session_id: str,
    message: str,
    *,
    correlation_id: str = "",
    stream: bool = False,
) -> dict[str, Any]:
    """Invoke AgentCore Runtime and return the complete response.

    Uses the session_id to create or resume AgentCore sessions. AgentCore
    manages full conversation history internally via the sessionId.
    Extracts token usage and finish reason from trace events.

    Args:
        session_id: User/session identifier for AgentCore session management.
        message: Current user message text (NOT full history).
        correlation_id: Request correlation identifier for logging.
        stream: If True, consumes the stream internally and returns assembled text.
            For progressive streaming, use `invoke_agentcore_streaming` instead.

    Returns:
        Dict with keys: response, usage, finishReason, sessionId.

    Raises:
        RuntimeError: If AgentCore Runtime returns an API error.
    """
    if stream:
        # Consume the streaming generator and assemble the full response
        chunks: list[str] = []
        result_metadata: dict[str, Any] = {}

        for chunk_data in invoke_agentcore_streaming(
            session_id=session_id,
            message=message,
            correlation_id=correlation_id,
            _return_metadata=result_metadata,
        ):
            chunks.append(chunk_data)

        return {
            "response": "".join(chunks),
            "usage": result_metadata.get("usage", {}),
            "finishReason": result_metadata.get("finishReason"),
            "sessionId": session_id,
        }

    start_time = time.time()

    session_state: dict[str, Any] = {
        "systemPrompt": SYSTEM_PROMPT,
    }

    invoke_params: dict[str, Any] = {
        "agentId": AGENT_ID,
        "agentAliasId": AGENT_ALIAS_ID,
        "sessionId": session_id,
        "inputText": message,
        "sessionState": session_state,
    }

    logger.info(
        "Invoking AgentCore Runtime",
        extra={
            "correlationId": correlation_id,
            "sessionId": session_id,
        },
    )

    try:
        response: Any = bedrock_agent_runtime.invoke_agent(**invoke_params)
    except ClientError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"]["Message"]
        logger.error(
            "AgentCore Runtime API error",
            extra={
                "correlationId": correlation_id,
                "errorType": error_code,
                "errorMessage": error_message,
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"AgentCore Runtime error: {error_code}: {error_message}") from e

    # Process the completion stream (non-streaming: consume all at once)
    completion_text, usage, finish_reason = _process_completion_stream(response)

    latency_ms = int((time.time() - start_time) * 1000)

    log_ai_interaction(
        logger,
        correlation_id=correlation_id,
        model="agentcore",
        input_tokens=usage.get("inputTokens", 0),
        output_tokens=usage.get("outputTokens", 0),
        total_tokens=usage.get("totalTokens", 0),
        latency_ms=latency_ms,
        finish_reason=finish_reason or "end_turn",
    )

    return {
        "response": completion_text,
        "usage": usage,
        "finishReason": finish_reason,
        "sessionId": session_id,
    }


def invoke_agentcore_streaming(
    session_id: str,
    message: str,
    *,
    correlation_id: str = "",
    _return_metadata: dict[str, Any] | None = None,
) -> Generator[str, None, None]:
    """Stream AgentCore Runtime response, yielding text chunks as they arrive.

    Yields each text chunk from the AgentCore completion stream as it becomes
    available. After the stream completes, logs the AI interaction with total
    token usage. AgentCore manages full conversation history internally via
    the sessionId.

    Args:
        session_id: User/session identifier for AgentCore session management.
        message: Current user message text (NOT full history).
        correlation_id: Request correlation identifier for logging.
        _return_metadata: Internal dict to pass metadata back to caller (usage, finishReason).

    Yields:
        Text content strings as they arrive from the AgentCore completion stream.

    Raises:
        RuntimeError: If AgentCore Runtime returns an API error.
    """
    start_time = time.time()

    session_state: dict[str, Any] = {
        "systemPrompt": SYSTEM_PROMPT,
    }

    invoke_params: dict[str, Any] = {
        "agentId": AGENT_ID,
        "agentAliasId": AGENT_ALIAS_ID,
        "sessionId": session_id,
        "inputText": message,
        "sessionState": session_state,
    }

    logger.info(
        "Invoking AgentCore Runtime (streaming)",
        extra={
            "correlationId": correlation_id,
            "sessionId": session_id,
        },
    )

    try:
        response: Any = bedrock_agent_runtime.invoke_agent(**invoke_params)
    except ClientError as e:
        latency_ms = int((time.time() - start_time) * 1000)
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"]["Message"]
        logger.error(
            "AgentCore Runtime API error (streaming)",
            extra={
                "correlationId": correlation_id,
                "errorType": error_code,
                "errorMessage": error_message,
                "latencyMs": latency_ms,
            },
        )
        raise RuntimeError(f"AgentCore Runtime error: {error_code}: {error_message}") from e

    # Stream chunks from the completion event stream
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str | None = None

    if "completion" in response:
        for event_chunk in response["completion"]:
            if "chunk" in event_chunk:
                chunk_data = event_chunk["chunk"]
                if "bytes" in chunk_data:
                    text = chunk_data["bytes"].decode("utf-8")
                    if text:
                        yield text

            if "trace" in event_chunk:
                trace = event_chunk["trace"].get("trace", {})
                orchestration_trace = trace.get("orchestrationTrace", {})

                # Extract token usage from model invocation output
                if "modelInvocationOutput" in orchestration_trace:
                    model_output = orchestration_trace["modelInvocationOutput"]
                    usage = model_output.get("metadata", {}).get("usage", {})
                    input_tokens = usage.get("inputTokens", input_tokens)
                    output_tokens = usage.get("outputTokens", output_tokens)

                # Extract finish reason from observation
                if "observation" in orchestration_trace:
                    observation = orchestration_trace["observation"]
                    if observation.get("finalResponse"):
                        finish_reason = "end_turn"

    # Default finish reason
    if finish_reason is None:
        finish_reason = "end_turn"

    total_tokens = input_tokens + output_tokens
    latency_ms = int((time.time() - start_time) * 1000)

    # Log AI interaction once after stream completes (Requirement 15.3)
    log_ai_interaction(
        logger,
        correlation_id=correlation_id,
        model="agentcore",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        finish_reason=finish_reason,
    )

    # Pass metadata back to caller if requested
    if _return_metadata is not None:
        _return_metadata["usage"] = {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        }
        _return_metadata["finishReason"] = finish_reason


def _process_completion_stream(response: Any) -> tuple[str, dict[str, Any], str | None]:
    """Process the AgentCore completion event stream and extract results.

    Consumes the full event stream, assembling text and extracting token usage
    and finish reason from trace events.

    Args:
        response: Raw boto3 response from invoke_agent.

    Returns:
        Tuple of (completion_text, usage_dict, finish_reason).
    """
    completion_text = ""
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str | None = None

    if "completion" in response:
        for event_chunk in response["completion"]:
            if "chunk" in event_chunk:
                chunk_data = event_chunk["chunk"]
                if "bytes" in chunk_data:
                    completion_text += chunk_data["bytes"].decode("utf-8")

            if "trace" in event_chunk:
                trace = event_chunk["trace"].get("trace", {})
                orchestration_trace = trace.get("orchestrationTrace", {})

                # Extract token usage from model invocation output
                if "modelInvocationOutput" in orchestration_trace:
                    model_output = orchestration_trace["modelInvocationOutput"]
                    usage = model_output.get("metadata", {}).get("usage", {})
                    input_tokens = usage.get("inputTokens", input_tokens)
                    output_tokens = usage.get("outputTokens", output_tokens)

                # Extract finish reason from observation
                if "observation" in orchestration_trace:
                    observation = orchestration_trace["observation"]
                    if observation.get("finalResponse"):
                        finish_reason = "end_turn"

    # Default finish reason if completion produced text
    if finish_reason is None and completion_text:
        finish_reason = "end_turn"

    total_tokens = input_tokens + output_tokens
    usage_dict: dict[str, Any] = {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }

    return completion_text, usage_dict, finish_reason
