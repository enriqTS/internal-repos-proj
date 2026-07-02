"""Shared test configuration for ECS WebSocket variant tests.

Sets mock AWS credentials to allow boto3 client creation at module import
time without real credentials.
"""

import os

# Set mock AWS credentials before any test imports boto3
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SECURITY_TOKEN", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
