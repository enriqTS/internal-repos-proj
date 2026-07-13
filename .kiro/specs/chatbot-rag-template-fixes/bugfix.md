# Bugfix Requirements Document

## Introduction

Architecture review of the chatbot-rag-agentcore and chatbot-rag-mantle templates revealed multiple violations of upd8 steering conventions (serverless, Python, Terraform). These are not new features but corrections to bring existing template code into compliance with established standards: API key enforcement, least-privilege IAM, explicit encryption, proper SDK client lifecycle, direct Powertools usage, explicit Lambda memory sizing, and removal of an unnecessary compute layer in the AgentCore variant.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the OpenAPI spec defines the `/chat` endpoint THEN the system does not enforce API key authentication, leaving the endpoint publicly accessible without any authorization mechanism

1.2 WHEN the AgentCore template provisions compute resources THEN the system deploys a separate Tool Executor Lambda that is redundant because Bedrock Knowledge Base has native integration with AgentCore action groups, adding unnecessary cost and latency

1.3 WHEN Lambda functions initialize logging THEN the system uses a shared `logging_config.py` wrapper in a Lambda Layer instead of importing and using `aws-lambda-powertools` Logger/Tracer directly in each handler, violating the convention of direct Powertools usage

1.4 WHEN the Mantle AI Caller Lambda handler is invoked THEN the system creates a new `OpenAI` client instance inside the handler on every invocation, wasting connection reuse opportunities across warm starts

1.5 WHEN Lambda functions are provisioned via Terraform THEN the system does not specify an explicit `memory_size` attribute, defaulting to 128 MB which is insufficient for AI workloads (AgentCore/Mantle calls) and borderline for utility Lambdas

1.6 WHEN S3 buckets, DynamoDB tables, and SQS queues are provisioned THEN the system does not declare explicit encryption-at-rest configuration (SSE-S3/SSE-KMS for S3, encryption for DynamoDB, KMS for SQS), relying on implicit AWS defaults rather than explicit declarations

1.7 WHEN the IAM policy for the Bedrock Knowledge Base s3vectors integration is defined THEN the system uses `Resource = ["*"]` instead of scoping to the specific vector store bucket ARN, violating least-privilege

1.8 WHEN X-Ray tracing is enabled on Lambda functions THEN the system does not grant explicit `xray:PutTraceSegments` and `xray:PutTelemetryData` IAM permissions in the Lambda execution roles

1.9 WHEN tests reference the Tool Executor Lambda in the AgentCore template THEN the system contains stale test code for a component that should no longer exist after removing the redundant Tool Executor

### Expected Behavior (Correct)

2.1 WHEN the OpenAPI spec defines the `/chat` endpoint THEN the system SHALL require API key authentication via an `x-amazon-apigateway-api-key-source` header and `security` scheme, and the Terraform configuration SHALL provision an API key and usage plan associated with the API stage

2.2 WHEN the AgentCore template provisions compute resources THEN the system SHALL NOT deploy a Tool Executor Lambda; instead, it SHALL configure the AgentCore agent to use Bedrock Knowledge Base native retrieval as an action group, removing the unnecessary Lambda hop

2.3 WHEN Lambda functions initialize logging THEN each handler SHALL import and instantiate `aws_lambda_powertools.Logger` and `aws_lambda_powertools.Tracer` directly at module level, without any intermediate shared wrapper module for logging configuration

2.4 WHEN the Mantle AI Caller Lambda module is loaded THEN the system SHALL create the `OpenAI` client instance at module level (outside the handler function) so that TCP connections are reused across warm invocations

2.5 WHEN Lambda functions are provisioned via Terraform THEN the system SHALL declare an explicit `memory_size` variable defaulting to 512 MB for AI-calling Lambdas (orchestrator, ai_caller) and 256 MB for utility Lambdas (tool_executor), configurable per environment

2.6 WHEN S3 buckets, DynamoDB tables, and SQS queues are provisioned THEN the system SHALL declare explicit encryption-at-rest configuration: `aws_s3_bucket_server_side_encryption_configuration` for S3, `server_side_encryption { enabled = true }` for DynamoDB, and `kms_master_key_id` or `sqs_managed_sse_enabled` for SQS

2.7 WHEN the IAM policy for Bedrock Knowledge Base s3vectors integration is defined THEN the system SHALL scope the `Resource` to the specific vector store bucket ARN (e.g., `arn:aws:s3:::${var.project_prefix}-*-vectors/*`) following least-privilege

2.8 WHEN X-Ray tracing is enabled on Lambda functions THEN the Lambda execution role SHALL include explicit IAM permissions for `xray:PutTraceSegments` and `xray:PutTelemetryData` on `Resource = ["*"]` (as required by X-Ray service)

2.9 WHEN the Tool Executor Lambda is removed from the AgentCore template THEN the system SHALL remove or update all associated test files to reflect the new architecture, and the full test suite SHALL pass without errors

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Mantle template provisions its Tool Executor Lambda THEN the system SHALL CONTINUE TO deploy and configure the Tool Executor Lambda as before, since the Mantle variant still requires it for its orchestrator-managed tool-use loop

3.2 WHEN the orchestrator Lambda invokes the AI Caller Lambda THEN the system SHALL CONTINUE TO pass correlation IDs, conversation history, system prompt, and tool definitions in the same payload format

3.3 WHEN DynamoDB stores conversation history THEN the system SHALL CONTINUE TO use the same partition key schema (`userId`) and message list structure

3.4 WHEN the API Gateway receives a POST /chat request THEN the system SHALL CONTINUE TO validate the request body against the OpenAPI schema (requiring `userId` and `message` fields) before forwarding to SQS

3.5 WHEN the Mantle AI Caller Lambda invokes the Bedrock Mantle API THEN the system SHALL CONTINUE TO use `POST /responses` with `stream=False` and return the same response structure to the orchestrator

3.6 WHEN the orchestrator manages the tool-use loop (Mantle variant) THEN the system SHALL CONTINUE TO iterate up to the configured maximum iterations and terminate with an error if the limit is reached without a text-only response

3.7 WHEN Terraform constructs resource names THEN the system SHALL CONTINUE TO use the `{prefix}-{function}` naming pattern for all resources

3.8 WHEN the S3 RAG bucket is provisioned THEN the system SHALL CONTINUE TO enable versioning and Block Public Access on all four settings

3.9 WHEN structured JSON logs are emitted THEN the system SHALL CONTINUE TO include `timestamp`, `level`, `service`, `correlation_id`, and `message` fields, and AI interaction logs SHALL CONTINUE TO include `logType: "ai-interaction"`
