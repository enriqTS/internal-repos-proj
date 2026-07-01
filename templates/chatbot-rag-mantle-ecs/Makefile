.PHONY: build deploy test lint format clean docker-build docker-push

ENV ?= dev
AWS_REGION ?= us-east-1
ECR_REPO ?= ""

build:
	uv sync

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

docker-build:
	docker build -t $(ECR_REPO):latest .

docker-push:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REPO)
	docker push $(ECR_REPO):latest
