"""Shared data models for chatbot RAG template variants.

Pydantic v2 models with field validation for chat requests, responses, and messages.
Reusable across Lambda and ECS variants.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator


class ChatRequest(BaseModel):
    """Incoming chat request with validation.

    Used by both REST (POST /chat) and WebSocket (sendMessage) endpoints.
    """

    userId: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description="User identifier (1-256 characters)",
    )
    message: str = Field(
        ...,
        min_length=1,
        max_length=4096,
        description="Chat message content (1-4096 characters)",
    )

    @field_validator("userId")
    @classmethod
    def userId_must_not_be_blank(cls, v: str) -> str:
        """Ensure userId is not just whitespace."""
        if not v.strip():
            msg = "userId must not be blank or whitespace-only"
            raise ValueError(msg)
        return v

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, v: str) -> str:
        """Ensure message is not just whitespace."""
        if not v.strip():
            msg = "message must not be blank or whitespace-only"
            raise ValueError(msg)
        return v


class ChatResponse(BaseModel):
    """Response from the chatbot after processing a message.

    Returned by REST (POST /chat) and used to build WebSocket response messages.
    """

    response: str = Field(
        ...,
        description="AI-generated response text",
    )
    conversationId: str = Field(
        ...,
        description="User identifier / conversation identifier",
    )
    timestamp: str = Field(
        ...,
        description="ISO 8601 timestamp with timezone offset",
    )


class ErrorResponse(BaseModel):
    """Error response returned on validation or processing failures.

    REST: HTTP 400/500 with this body. WebSocket: sent as error message type.
    """

    error: str = Field(
        ...,
        description="Human-readable error description",
    )


class ChatMessage(BaseModel):
    """Represents a single message in conversation history.

    Stored in DynamoDB User_Context_DB for conversation context management.
    """

    role: str = Field(
        ...,
        description="Message role: 'user', 'assistant', or 'tool'",
    )
    content: str = Field(
        ...,
        description="Message content text",
    )
    timestamp: str = Field(
        ...,
        description="ISO 8601 timestamp when the message was created",
    )
    tool_calls: list[dict[str, Any]] | None = Field(
        default=None,
        description="Tool calls requested by the assistant (if any)",
    )
    tool_results: list[dict[str, Any]] | None = Field(
        default=None,
        description="Tool execution results (if any)",
    )
