# ------------------------------------------------------------------------------
# Bedrock Knowledge Base — RAG Document Indexing (S3 Vectors)
# ------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# IAM Role for Bedrock KB to access S3
resource "aws_iam_role" "bedrock_kb" {
  name = "${local.name_prefix}-bedrock-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_s3_access" {
  name = "${local.name_prefix}-bedrock-kb-s3-access"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [var.rag_bucket_arn, "${var.rag_bucket_arn}/*"]
      }
    ]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_model_access" {
  name = "${local.name_prefix}-bedrock-kb-model-access"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = ["arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/amazon.titan-embed-text-v2:0"]
      }
    ]
  })
}

resource "aws_iam_role_policy" "bedrock_kb_s3vectors_access" {
  name = "${local.name_prefix}-bedrock-kb-s3vectors-access"
  role = aws_iam_role.bedrock_kb.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3vectors:CreateIndex",
          "s3vectors:DeleteIndex",
          "s3vectors:GetIndex",
          "s3vectors:ListIndexes",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:QueryVectors"
        ]
        Resource = [
          "arn:aws:s3vectors:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:vector-bucket/${local.name_prefix}-vectors",
          "arn:aws:s3vectors:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:vector-bucket/${local.name_prefix}-vectors/*"
        ]
      }
    ]
  })
}

# S3 Vectors — Vector Bucket + Index
resource "aws_s3vectors_vector_bucket" "kb" {
  vector_bucket_name = "${local.name_prefix}-vectors"
}

resource "aws_s3vectors_index" "main" {
  vector_bucket_name = aws_s3vectors_vector_bucket.kb.vector_bucket_name
  index_name         = "${local.name_prefix}-idx"
  data_type          = "float32"
  dimension          = 1024 # Titan Embed Text v2
  distance_metric    = "cosine"
}

# Bedrock Knowledge Base
resource "aws_bedrockagent_knowledge_base" "main" {
  name     = "${local.name_prefix}-knowledge-base"
  role_arn = aws_iam_role.bedrock_kb.arn

  knowledge_base_configuration {
    type = "VECTOR"

    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/amazon.titan-embed-text-v2:0"

      embedding_model_configuration {
        bedrock_embedding_model_configuration {
          dimensions          = 1024
          embedding_data_type = "FLOAT32"
        }
      }
    }
  }

  storage_configuration {
    type = "S3_VECTORS"

    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.main.index_arn
    }
  }

  tags = {
    Name    = "${local.name_prefix}-knowledge-base"
    Project = var.project_name
  }
}

# S3 Data Source for the Knowledge Base
resource "aws_bedrockagent_data_source" "s3" {
  name              = "${local.name_prefix}-s3-data-source"
  knowledge_base_id = aws_bedrockagent_knowledge_base.main.id

  data_source_configuration {
    type = "S3"

    s3_configuration {
      bucket_arn = var.rag_bucket_arn
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"

      fixed_size_chunking_configuration {
        max_tokens         = 300
        overlap_percentage = 20
      }
    }
  }

  data_deletion_policy = "RETAIN"
}
