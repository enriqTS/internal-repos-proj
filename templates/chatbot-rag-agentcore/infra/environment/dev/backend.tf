terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "chatbot-rag-agentcore/dev/terraform.tfstate"
    region = "us-east-1"
  }
}
