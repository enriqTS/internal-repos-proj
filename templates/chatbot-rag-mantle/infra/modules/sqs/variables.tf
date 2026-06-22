variable "project_prefix" {
  description = "Prefix used for naming all resources (e.g., my-chatbot)"
  type        = string
}

variable "max_receive_count" {
  description = "Number of times a message can be received before being sent to the DLQ"
  type        = number
  default     = 3
}
