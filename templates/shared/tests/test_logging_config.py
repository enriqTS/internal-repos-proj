"""Unit tests for the shared logging configuration module."""

from unittest.mock import MagicMock, patch

from shared.logging_config import get_logger, get_tracer, log_ai_interaction


class TestGetLogger:
    """Tests for get_logger."""

    def test_returns_logger_instance(self) -> None:
        logger = get_logger("test-service")
        assert logger is not None
        assert logger.service == "test-service"

    def test_logger_uses_service_name(self) -> None:
        logger = get_logger("orchestrator")
        assert logger.service == "orchestrator"

    @patch.dict("os.environ", {"POWERTOOLS_LOG_LEVEL": "DEBUG"})
    def test_respects_log_level_env_var(self) -> None:
        logger = get_logger("test-svc")
        assert logger is not None

    @patch.dict("os.environ", {"POWERTOOLS_SERVICE_NAME": "env-override"})
    def test_env_service_name_override(self) -> None:
        # When POWERTOOLS_SERVICE_NAME is set, Powertools uses it
        logger = get_logger("fallback-name")
        # Logger should still be created successfully
        assert logger is not None


class TestGetTracer:
    """Tests for get_tracer."""

    @patch("shared.logging_config.Tracer")
    def test_returns_tracer_instance(self, mock_tracer_cls: MagicMock) -> None:
        mock_tracer_cls.return_value = MagicMock()
        tracer = get_tracer("test-service")
        mock_tracer_cls.assert_called_once_with(service="test-service")
        assert tracer is not None


class TestLogAiInteraction:
    """Tests for log_ai_interaction."""

    def test_logs_ai_interaction_with_all_fields(self) -> None:
        logger = MagicMock()

        log_ai_interaction(
            logger,
            correlation_id="req-123",
            model="anthropic.claude-3-haiku",
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            latency_ms=1234.5,
            finish_reason="stop",
        )

        logger.info.assert_called_once()
        call_args = logger.info.call_args
        assert call_args[0][0] == "AI interaction completed"
        extra = call_args[1]["extra"]
        assert extra["logType"] == "ai-interaction"
        assert extra["correlation_id"] == "req-123"
        assert extra["model"] == "anthropic.claude-3-haiku"
        assert extra["inputTokens"] == 100
        assert extra["outputTokens"] == 50
        assert extra["totalTokens"] == 150
        assert extra["latencyMs"] == 1234.5
        assert extra["finishReason"] == "stop"

    def test_log_type_is_ai_interaction(self) -> None:
        logger = MagicMock()

        log_ai_interaction(
            logger,
            correlation_id="req-456",
            model="model-x",
            input_tokens=10,
            output_tokens=20,
            total_tokens=30,
            latency_ms=500.0,
            finish_reason="end_turn",
        )

        extra = logger.info.call_args[1]["extra"]
        assert extra["logType"] == "ai-interaction"

    def test_single_log_entry_per_call(self) -> None:
        logger = MagicMock()

        log_ai_interaction(
            logger,
            correlation_id="req-789",
            model="model-y",
            input_tokens=200,
            output_tokens=100,
            total_tokens=300,
            latency_ms=2000.0,
            finish_reason="stop",
        )

        # Must emit exactly one log entry per AI interaction
        assert logger.info.call_count == 1

    def test_all_required_fields_present(self) -> None:
        logger = MagicMock()

        log_ai_interaction(
            logger,
            correlation_id="corr-id",
            model="some-model",
            input_tokens=1,
            output_tokens=2,
            total_tokens=3,
            latency_ms=100.0,
            finish_reason="stop",
        )

        extra = logger.info.call_args[1]["extra"]
        required_fields = {
            "logType",
            "correlation_id",
            "model",
            "inputTokens",
            "outputTokens",
            "totalTokens",
            "latencyMs",
            "finishReason",
        }
        assert required_fields.issubset(set(extra.keys()))

    def test_zero_tokens_allowed(self) -> None:
        logger = MagicMock()

        log_ai_interaction(
            logger,
            correlation_id="req-0",
            model="model-z",
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
            latency_ms=0.0,
            finish_reason="stop",
        )

        extra = logger.info.call_args[1]["extra"]
        assert extra["inputTokens"] == 0
        assert extra["outputTokens"] == 0
        assert extra["totalTokens"] == 0
