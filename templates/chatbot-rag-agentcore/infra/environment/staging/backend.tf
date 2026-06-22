terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "chatbot-rag-agentcore/staging/terraform.tfstate"
    region = "us-east-1"
  }
}
