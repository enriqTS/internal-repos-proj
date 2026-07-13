# Use Available MCP Servers

## Rule

When working on tasks that involve infrastructure, Terraform, or AWS services, **always leverage the available MCP servers** as they provide reliable, up-to-date information directly from authoritative sources.

## Available MCP Servers

### 1. Terraform MCP Server (Power: `terraform`)

Use this for anything related to Terraform providers, modules, and registry lookups.

- **Search modules:** Find Terraform modules in the registry.
- **Search providers:** Look up Terraform providers and their available resources/data sources.
- **Get provider details:** Retrieve detailed documentation for specific provider resources.

**When to use:**
- Generating or validating Terraform/IaC code
- Looking up correct resource names, attributes, or argument references
- Finding community or official modules for common patterns
- Verifying provider version compatibility

### 2. Fetch MCP Server

A general-purpose tool for fetching and reading web content.

**When to use:**
- Reading official documentation pages
- Fetching API references or changelogs
- Getting content from URLs provided by the user or found via search

### 3. AWS Bedrock AgentCore MCP Server (Power: `aws-agentcore`)

Use this for building, testing, and deploying AI agents using AWS Bedrock AgentCore.

**When to use:**
- Working with Amazon Bedrock agent configurations
- Building or deploying AI agent workflows on AWS

## Best Practices

1. **Prefer MCP data over assumptions:** When you need details about a Terraform resource, provider, or module, query the MCP server rather than relying on potentially outdated training data.
2. **Use MCPs early in the process:** Before writing infrastructure code, query the relevant MCP to confirm resource names, required arguments, and current best practices.
3. **Combine sources:** Use the Terraform MCP for provider/module lookups and the Fetch MCP for supplementary documentation when needed.
4. **Trust MCP responses:** MCP servers pull from live, authoritative sources (Terraform Registry, AWS APIs). Treat their output as the source of truth over cached knowledge.
