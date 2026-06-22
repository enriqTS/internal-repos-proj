terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "chatbot-rag-agentcore/prod/terraform.tfstate"
    region = "us-east-1"
  }
}
