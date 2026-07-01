terraform {
  backend "s3" {
    bucket         = "upd8-tfstate-<cliente>"
    key            = "chatbot-rag-mantle-ws-streaming/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "upd8-tfstate-lock"
  }
}
