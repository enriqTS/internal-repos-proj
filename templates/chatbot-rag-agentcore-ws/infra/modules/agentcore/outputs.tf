output "agent_id" {
  description = "ID of the Bedrock AgentCore agent"
  value       = aws_bedrockagent_agent.chatbot.agent_id
}

output "agent_alias_id" {
  description = "ID of the Bedrock AgentCore agent alias"
  value       = aws_bedrockagent_agent_alias.chatbot.agent_alias_id
}

output "agent_arn" {
  description = "ARN of the Bedrock AgentCore agent"
  value       = aws_bedrockagent_agent.chatbot.agent_arn
}
