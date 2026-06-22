"""Shared data models and types used across Lambda functions."""

from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class ChatMessage:
    """Represents a single message in a conversation."""

    role: str  # "user" | "assistant" | "tool"
    content: str
    timestamp: str
    tool_calls: Optional[List[dict]] = None
    tool_results: Optional[List[dict]] = None


@dataclass
class ChatRequest:
    """Incoming chat request from API Gateway."""

    user_id: str
    message: str
    correlation_id: str
    timestamp: str
