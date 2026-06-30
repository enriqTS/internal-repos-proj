"""Shared data models and types used across Lambda functions."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ChatMessage:
    """Represents a single message in a conversation."""

    role: str  # "user" | "assistant" | "tool"
    content: str
    timestamp: str
    tool_calls: list[dict[str, Any]] | None = None
    tool_results: list[dict[str, Any]] | None = None


@dataclass
class ChatRequest:
    """Incoming chat request from API Gateway."""

    user_id: str
    message: str
    correlation_id: str
    timestamp: str
