locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

data "archive_file" "shared_layer" {
  type        = "zip"
  source_dir  = "${path.root}/../../../src/layers/shared"
  output_path = "${path.root}/../../../build/shared-layer.zip"
}

resource "aws_lambda_layer_version" "shared" {
  layer_name          = "${local.name_prefix}-shared-layer"
  filename            = data.archive_file.shared_layer.output_path
  source_code_hash    = data.archive_file.shared_layer.output_base64sha256
  compatible_runtimes = ["python3.12"]
  description         = "Shared utilities: powertools logging, data models"
}
