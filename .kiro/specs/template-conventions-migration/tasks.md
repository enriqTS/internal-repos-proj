# Implementation Plan: Template Conventions Migration

## Overview

Migrate both chatbot RAG templates (`chatbot-rag-mantle` and `chatbot-rag-agentcore`) from per-Lambda `requirements.txt` + pip workflow to the upd8 Python and Terraform conventions. Start with the Mantle template, then replicate to AgentCore. No application logic changes — structural and configuration refactor only.

## Tasks

- [x] 1. Create pyproject.toml and uv.lock for chatbot-rag-mantle
  - [x] 1.1 Create `pyproject.toml` at chatbot-rag-mantle template root
    - Define `[project]` section with name, version, description, `requires-python = ">=3.12"`
    - Add runtime dependencies: `aws-lambda-powertools[all]~=3.4`, `boto3>=1.34.0,<2.0.0`, `openai>=1.50.0,<2.0.0`
    - Add `[dependency-groups]` dev group: `pytest~=8.0`, `hypothesis~=6.100`, `ruff~=0.11`, `pytest-mock~=3.14`
    - Add `[tool.ruff]` section: `target-version = "py312"`, `line-length = 120`
    - Add `[tool.ruff.lint]` with `select = ["E", "F", "I", "UP", "B", "ANN"]` and appropriate ignores
    - Add `[tool.ruff.format]` with `quote-style = "double"`
    - Add `[tool.pytest.ini_options]` with `testpaths = ["tests"]` and `pythonpath` entries for all Lambda sources
    - _Requirements: 1.1, 1.4, 1.6, 3.1, 3.2, 3.3, 3.7, 4.2, 5.2, 5.3_

  - [x] 1.2 Generate `uv.lock` and delete per-Lambda `requirements.txt` files
    - Run `uv lock` at the template root to generate `uv.lock`
    - Delete `src/orchestrator/requirements.txt`
    - Delete `src/ai_caller/requirements.txt`
    - Delete `src/tool_executor/requirements.txt`
    - Delete `src/responses_reader/requirements.txt`
    - Delete `src/kb_sync/requirements.txt`
    - Delete `src/layers/shared/requirements.txt`
    - _Requirements: 1.2, 1.5, 1.8_

- [x] 2. Create Makefile for Lambda packaging
  - [x] 2.1 Create `Makefile` at chatbot-rag-mantle template root
    - Define variables for Lambda source directories and Python platform/version
    - Create `requirements.txt` target using `uv export --format requirements-txt --no-dev --no-hashes`
    - Create per-Lambda package targets using `pip install -r requirements.txt -t <dir> --platform manylinux2014_x86_64 --python-version 3.12 --only-binary=:all:`
    - Create `package-shared-layer` target for `src/layers/shared/python/`
    - Create `all` phony target depending on all package targets
    - Create `clean` target to remove packaging artifacts
    - Ensure each target exits non-zero on failure with informative error output
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Add type hints to existing handler files
  - [x] 3.1 Add type annotations to `src/orchestrator/handler.py`
    - Add type hints to all function parameters and return types
    - Use `Any` with inline comment where boto3 response types are unavailable
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 3.2 Add type annotations to `src/ai_caller/handler.py`
    - Add type hints to all function parameters and return types
    - Use `Any` with inline comment where boto3 response types are unavailable
    - _Requirements: 4.1, 4.4_

  - [x] 3.3 Add type annotations to `src/tool_executor/handler.py`
    - Add type hints to all function parameters and return types
    - Use `Any` with inline comment where boto3 response types are unavailable
    - _Requirements: 4.1, 4.4_

  - [x] 3.4 Add type annotations to `src/responses_reader/handler.py`
    - Add type hints to all function parameters and return types
    - Use `Any` with inline comment where boto3 response types are unavailable
    - _Requirements: 4.1, 4.4_

  - [x] 3.5 Add type annotations to `src/kb_sync/handler.py`
    - Add type hints to all function parameters and return types
    - Use `Any` with inline comment where boto3 response types are unavailable
    - _Requirements: 4.1, 4.4_

  - [x] 3.6 Add type annotations to shared layer models and utilities
    - Add full type annotations to `src/layers/shared/python/shared/models.py` (use dataclasses or TypedDict)
    - Add type annotations to any other `.py` files under `src/layers/shared/`
    - _Requirements: 4.1, 4.3_

- [x] 4. Checkpoint — Verify ruff passes on typed code
  - Ensure `uv run ruff check .` exits zero on the template source files, ask the user if questions arise.

- [x] 5. Create pytest test infrastructure
  - [x] 5.1 Create `tests/conftest.py` with shared fixtures
    - Create `tests/` directory at template root
    - Implement `_aws_env_vars` fixture (autouse) setting AWS credentials and Powertools env vars via `monkeypatch`
    - Implement `_lambda_env_vars` fixture (autouse) setting Lambda-specific env vars (table names, function names, etc.)
    - _Requirements: 5.1, 5.4, 5.6_

  - [x] 5.2 Create `tests/test_orchestrator.py` example test
    - Create `lambda_context` fixture with mock Lambda context
    - Create `sqs_event` fixture with sample SQS event payload
    - Write at least one test demonstrating mock patching of DynamoDB table, Lambda client, and responses table
    - Invoke the handler and assert expected status code and mock interactions
    - _Requirements: 5.1, 5.4_

  - [x] 5.3 Create `tests/test_ai_caller.py` example test
    - Demonstrate mocking of the Bedrock/OpenAI client
    - Write at least one test invoking the handler with a sample event
    - _Requirements: 5.1, 5.4_

  - [x] 5.4 Create `tests/test_tool_executor.py` example test
    - Demonstrate mocking of Lambda invocation and tool execution
    - Write at least one test invoking the handler with a sample event
    - _Requirements: 5.1, 5.4_

  - [x] 5.5 Create `tests/test_responses_reader.py` example test
    - Demonstrate mocking of DynamoDB responses table
    - Write at least one test invoking the handler with a sample event
    - _Requirements: 5.1, 5.4_

  - [x] 5.6 Create `tests/test_kb_sync.py` example test
    - Demonstrate mocking of S3 and Knowledge Base operations
    - Write at least one test invoking the handler with a sample event
    - _Requirements: 5.1, 5.4_

- [x] 6. Checkpoint — Verify pytest passes
  - Ensure `uv run pytest` exits with code 0 and all tests pass with no real AWS credentials needed, ask the user if questions arise.

- [x] 7. Terraform file reorganization and convention alignment
  - [x] 7.1 Create `providers.tf` in each environment folder (dev, staging, prod)
    - Extract `terraform {}` block with `required_version >= 1.5` and `required_providers` (aws ~> 6.0)
    - Add `provider "aws"` block with `region = var.aws_region` and `default_tags` (Project, Environment, ManagedBy, Client)
    - _Requirements: 7.1, 7.2, 8.2, 8.3_

  - [x] 7.2 Update `backend.tf` in each environment folder
    - Ensure it contains only `terraform { backend "s3" { ... } }` with upd8 pattern
    - Set `bucket = "upd8-tfstate-<cliente>"`, `key = "<project>/terraform.tfstate"`, `region = "us-east-1"`, `encrypt = true`, `dynamodb_table = "upd8-tfstate-lock"`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.3_

  - [x] 7.3 Update `variables.tf` in each environment folder
    - Add `project_name` variable with validation (lowercase alphanum + hyphens, max 20 chars)
    - Add `environment` variable with validation (restricted to dev, staging, prod)
    - Add `client` variable with non-empty validation (max 64 chars)
    - Add `aws_region`, `aws_account_id`, `model_id`, `mantle_base_url`, and other required variables
    - Remove `project_prefix` variable if it exists
    - _Requirements: 8.1, 8.5, 9.2, 9.3_

  - [x] 7.4 Update `main.tf` in each environment folder
    - Remove any `terraform {}` or `provider "aws" {}` blocks
    - Define `locals { name_prefix = "${var.project_name}-${var.environment}" }`
    - Update module calls to pass `project_name` and `environment` as separate variables
    - _Requirements: 7.4, 9.1, 9.3, 9.4_

  - [x] 7.5 Update all Terraform modules to use new naming convention
    - Replace `project_prefix` variable with separate `project_name` and `environment` variables in each module
    - Update internal `locals` to compute `"${var.project_name}-${var.environment}-<function>"` for resource names
    - Ensure all resource names follow the `Resource_Naming_Convention` pattern
    - _Requirements: 9.1, 9.4_

  - [x] 7.6 Create/update `terraform.tfvars.example` in each environment folder
    - Add `project_name`, `environment`, `client` with example values and descriptive comments
    - Include comment showing combined naming example (e.g., `my-chatbot-dev-orchestrator`)
    - Include note about 63-char AWS naming limit
    - Add all other variables with documented defaults
    - _Requirements: 8.4, 9.5_

- [x] 8. Checkpoint — Verify Terraform validates
  - Ensure `terraform validate` passes in each environment folder, ask the user if questions arise.

- [x] 9. Update README and .gitignore for chatbot-rag-mantle
  - [x] 9.1 Update `.gitignore` at template root
    - Add `.ruff_cache/`
    - Add `.venv/` (remove `venv/` and `env/` entries)
    - Add `requirements.txt` (now a generated build artifact)
    - Ensure `uv.lock` is NOT listed
    - Preserve `.env` exclusion for secrets protection
    - Preserve existing Python bytecode, Terraform, build artifact, and OS file exclusions
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 9.2 Rewrite README.md with uv-based workflows
    - Update Prerequisites section: list `uv` (with link to https://docs.astral.sh/uv/), Terraform >= 1.5, Python 3.12, GNU Make
    - Add "Development Setup" section: `uv sync`, `uv run ruff format .`, `uv run ruff check .`, `uv run pytest`
    - Add "Testing" section: command, directory convention, mocking pattern explanation
    - Rewrite "Deployment" section: `make all` → `terraform init` → `terraform plan` → `terraform apply`
    - Document backend placeholder replacement (`<cliente>`, `<project>`)
    - Document that `uv.lock` is committed for reproducibility
    - Remove all references to `pip install`, `pip freeze`, `virtualenv`, `python -m venv`
    - Update project structure section to show new files (pyproject.toml, Makefile, tests/)
    - _Requirements: 2.1, 2.5, 3.5, 5.5, 6.5, 6.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 10. Replicate all changes to chatbot-rag-agentcore template
  - [x] 10.1 Create `pyproject.toml` for chatbot-rag-agentcore
    - Copy Mantle's pyproject.toml
    - Change project name to `"chatbot-rag-agentcore"`
    - Update description for AgentCore
    - Remove `openai` from `[project.dependencies]` (AgentCore uses only boto3 for Bedrock Agent Runtime)
    - Keep all other sections identical (ruff, pytest, dependency-groups)
    - _Requirements: 12.1, 12.2_

  - [x] 10.2 Generate `uv.lock` and delete per-Lambda `requirements.txt` for AgentCore
    - Run `uv lock` at AgentCore template root
    - Delete all per-Lambda `requirements.txt` files
    - _Requirements: 1.2, 1.5, 12.1_

  - [x] 10.3 Copy Makefile to chatbot-rag-agentcore
    - Copy Mantle's Makefile identically (same targets, same structure)
    - _Requirements: 2.3, 12.1_

  - [x] 10.4 Add type hints to AgentCore handler files
    - Apply same type annotation pattern as Mantle to all `handler.py` files and shared layer
    - _Requirements: 4.1, 12.1_

  - [x] 10.5 Copy pytest infrastructure to chatbot-rag-agentcore
    - Copy `tests/conftest.py` identically
    - Create equivalent test files for each AgentCore Lambda (adapting AI caller test to use Bedrock Agent Runtime mocks instead of OpenAI)
    - _Requirements: 5.1, 12.1_

  - [x] 10.6 Apply Terraform changes to chatbot-rag-agentcore
    - Copy `providers.tf`, update `backend.tf`, `variables.tf`, `main.tf` identically to Mantle
    - Update all modules to new naming convention
    - Create `terraform.tfvars.example` with AgentCore-specific defaults (no `mantle_base_url`)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.1, 12.3_

  - [x] 10.7 Copy `.gitignore` and rewrite README for chatbot-rag-agentcore
    - Copy `.gitignore` identically from Mantle
    - Write README with identical tooling sections (uv, ruff, pytest, deployment)
    - Differ only in AI service description and architecture diagram references
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.4_

- [x] 11. Final checkpoint — Verify both templates
  - Ensure `uv run ruff check .` and `uv run pytest` pass in both templates, `terraform validate` passes in all environment folders, and both templates have identical structure (except AI-specific deps). Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP — no tasks are marked optional in this plan since there are no property-based tests (the design explicitly states PBT does not apply to this configuration migration).
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- The Mantle template is implemented first (tasks 1–9), then replicated to AgentCore (task 10). This minimizes duplication effort.
- The `uv.lock` is a generated file but MUST be committed to version control (not gitignored).
- The `requirements.txt` at template root is now a build artifact generated by `Makefile` — it IS gitignored.
- Terraform changes are a file reorganization only — no infrastructure behavior should change (`terraform plan` should show zero changes).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["5.1", "7.1", "7.2", "7.3"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "7.4", "7.5"] },
    { "id": 5, "tasks": ["7.6", "9.1"] },
    { "id": 6, "tasks": ["9.2"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["10.2"] },
    { "id": 9, "tasks": ["10.3", "10.4", "10.5", "10.6"] },
    { "id": 10, "tasks": ["10.7"] }
  ]
}
```
