.PHONY: build deploy test lint format clean

ENV ?= dev

build:
	uv sync
	@echo "Packaging Lambda functions..."
	@mkdir -p build
	@for dir in src/connection_manager src/orchestrator src/ai_caller src/tool_executor; do \
		name=$$(basename $$dir); \
		cd $$dir && zip -r ../../build/$$name.zip . && cd ../..; \
	done
	@echo "Packaging shared layer..."
	cd src/layers/shared && zip -r ../../../build/shared-layer.zip python/

deploy:
	cd infra/environment/$(ENV) && terraform init && terraform apply

test:
	uv run pytest tests/ -v

lint:
	uv run ruff check .

format:
	uv run ruff format .

clean:
	rm -rf build/ __pycache__/ .pytest_cache/
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
