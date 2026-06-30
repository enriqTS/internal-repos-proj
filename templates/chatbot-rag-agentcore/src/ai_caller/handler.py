"""AI Caller Lambda — invokes Bedrock AgentCore Runtime."""

import json
import os
import time
import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit
from shared.logging_config import get_logger, log_ai_interaction

logger = get_logger("ai_caller")
metrics = Metrics(namespace="ChatbotRAG", service="ai-caller")

# PLACEHOLDER: Replace this system prompt with your own instructions.
SYSTEM_PROMPT = "You are a helpful assistant. Replace this prompt with your own instructions."

AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
AGENT_ALIAS_ID = os.environ.get("AGENT_ALIAS_ID", "TSTALIASID")
AGENT_ID = os.environ.get("AGENT_ID", "")

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")


@metrics.log_metrics(capture_cold_start_metric=True)
@logger.inject_lambda_context
def handler(event, context):
    """Invoke AgentCore Runtime with conversation and return response.

    Expected event payload:
    {
        "correlationId": "msg-abc-123",
        "messages": [...],
        "tools": [...],
        "userId": "user-123"
    }
    """
    correlation_id = event.get("correlationId")
    logger.set_correlation_id(correlation_id)

    messages = event.get("messages", [])
    tools = event.get("tools", [])
    user_id = event.get("userId", "")

    logger.info(
        "AI Caller invoked",
        extra={
            "messageCount": len(messages),
            "toolCount": len(tools),
            "userId": user_id,
        },
    )

    try:
        response = invoke_agentcore(
            session_id=user_id,
            messages=messages,
            tools=tools,
            correlation_id=correlation_id,
        )
        return response
    except Exception as e:
        logger.error(
            "AI Caller failed",
            extra={
                "errorType": type(e).__name__,
                "errorMessage": str(e),
            },
        )
        raise


def invoke_agentcore(
    session_id: str, messages: list, tools: list, correlation_id: str
) -> dict:
    """Call AgentCore Runtime API with session management.

    Uses the userId as the sessionId to create new or resume existing sessions.
    If no existing session is found for the user, AgentCore creates a new one.
    If a session already exists, AgentCore resumes it automatically.
    """
    start_time = time.time()

    # Build the input text from the most recent user message
    input_text = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            input_text = msg.get("content", "")
            break

    # Log AI interaction BEFORE request
    input_token_estimate = sum(len(str(m)) // 4 for m in messages)
    log_ai_interaction(
        logger,
        correlationId=correlation_id,
        model="agentcore",
        phase="request",
        inputMessageCount=len(messages),
        inputTokenEstimate=input_token_estimate,
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )

    # Build session state with system prompt
    session_state = {
        "systemPrompt": SYSTEM_PROMPT,
    }

    # Build invoke_agent parameters
    invoke_params = {
        "agentId": AGENT_ID,
        "agentAliasId": AGENT_ALIAS_ID,
        "sessionId": session_id,
        "inputText": input_text,
        "sessionState": session_state,
    }

    try:
        response = bedrock_agent_runtime.invoke_agent(**invoke_params)
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
        raise RuntimeError(
            f"AgentCore Runtime error: {error_code}: {error_message}"
        ) from e

    # Process the streaming response from AgentCore
    completion_text = ""
    input_tokens = None
    output_tokens = None
    total_tokens = None
    finish_reason = None
    tool_calls_requested = []

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
                    if input_tokens and output_tokens:
                        total_tokens = input_tokens + output_tokens

                # Extract tool call information from invocation input
                if "invocationInput" in orchestration_trace:
                    invocation = orchestration_trace["invocationInput"]
                    if "actionGroupInvocationInput" in invocation:
                        action_group = invocation["actionGroupInvocationInput"]
                        tool_name = action_group.get("function", "unknown")
                        tool_calls_requested.append(tool_name)

                # Extract finish reason from observation
                if "observation" in orchestration_trace:
                    observation = orchestration_trace["observation"]
                    if observation.get("finalResponse"):
                        finish_reason = "end_turn"

    latency_ms = int((time.time() - start_time) * 1000)

    # Default finish reason if not found in trace
    if finish_reason is None and completion_text:
        finish_reason = "end_turn"

    metrics.add_metric(name="AIModelLatency", unit=MetricUnit.Milliseconds, value=latency_ms)

    # Log AI interaction AFTER response
    log_ai_interaction(
        logger,
        correlationId=correlation_id,
        model="agentcore",
        phase="response",
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        totalTokens=total_tokens,
        latencyMs=latency_ms,
        finishReason=finish_reason,
    )

    # Log tool calls if any were requested
    if tool_calls_requested:
        logger.info(
            "AI requested tool calls",
            extra={
                "correlationId": correlation_id,
                "toolCallCount": len(tool_calls_requested),
                "toolNames": tool_calls_requested,
            },
        )

    # Build response payload for the orchestrator
    result = {
        "response": completion_text,
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        },
        "finishReason": finish_reason,
        "sessionId": session_id,
    }

    return result
