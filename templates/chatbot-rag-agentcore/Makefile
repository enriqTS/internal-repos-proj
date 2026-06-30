.PHONY: all clean package-orchestrator package-ai-caller package-tool-executor package-responses-reader package-kb-sync package-shared-layer

PYTHON_PLATFORM := manylinux2014_x86_64
PYTHON_VERSION := 3.12

# Lambda source directories
ORCHESTRATOR_DIR := src/orchestrator
AI_CALLER_DIR := src/ai_caller
TOOL_EXECUTOR_DIR := src/tool_executor
RESPONSES_READER_DIR := src/responses_reader
KB_SYNC_DIR := src/kb_sync
SHARED_LAYER_DIR := src/layers/shared/python

all: package-orchestrator package-ai-caller package-tool-executor package-responses-reader package-kb-sync package-shared-layer

# Export runtime dependencies only (no dev group)
requirements.txt: pyproject.toml uv.lock
	uv export --format requirements-txt --no-dev --no-hashes -o requirements.txt || { echo "ERROR: uv export failed — check pyproject.toml and uv.lock"; exit 1; }

package-orchestrator: requirements.txt
	pip install -r requirements.txt -t $(ORCHESTRATOR_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package orchestrator"; exit 1; }
	@echo "✓ Packaged orchestrator"

package-ai-caller: requirements.txt
	pip install -r requirements.txt -t $(AI_CALLER_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package ai_caller"; exit 1; }
	@echo "✓ Packaged ai_caller"

package-tool-executor: requirements.txt
	pip install -r requirements.txt -t $(TOOL_EXECUTOR_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package tool_executor"; exit 1; }
	@echo "✓ Packaged tool_executor"

package-responses-reader: requirements.txt
	pip install -r requirements.txt -t $(RESPONSES_READER_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package responses_reader"; exit 1; }
	@echo "✓ Packaged responses_reader"

package-kb-sync: requirements.txt
	pip install -r requirements.txt -t $(KB_SYNC_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package kb_sync"; exit 1; }
	@echo "✓ Packaged kb_sync"

package-shared-layer: requirements.txt
	pip install -r requirements.txt -t $(SHARED_LAYER_DIR) --platform $(PYTHON_PLATFORM) --python-version $(PYTHON_VERSION) --only-binary=:all: --quiet --upgrade || { echo "ERROR: Failed to package shared layer"; exit 1; }
	@echo "✓ Packaged shared layer"

clean:
	rm -f requirements.txt
	rm -rf $(ORCHESTRATOR_DIR)/*.dist-info $(ORCHESTRATOR_DIR)/bin
	rm -rf $(AI_CALLER_DIR)/*.dist-info $(AI_CALLER_DIR)/bin
	rm -rf $(TOOL_EXECUTOR_DIR)/*.dist-info $(TOOL_EXECUTOR_DIR)/bin
	rm -rf $(RESPONSES_READER_DIR)/*.dist-info $(RESPONSES_READER_DIR)/bin
	rm -rf $(KB_SYNC_DIR)/*.dist-info $(KB_SYNC_DIR)/bin
	rm -rf $(SHARED_LAYER_DIR)/*.dist-info $(SHARED_LAYER_DIR)/bin
	@echo "✓ Cleaned packaging artifacts"
