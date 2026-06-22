terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "chatbot-rag-mantle/dev/terraform.tfstate"
    region = "us-east-1"
  }
}
