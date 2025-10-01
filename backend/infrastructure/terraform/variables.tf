variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"  # Cheapest region for most services
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "rideshare"
}

variable "cognito_domain" {
  description = "Cognito domain prefix"
  type        = string
  default     = "rideshare-auth"
}

# Cost optimization variables
variable "lambda_memory_size" {
  description = "Lambda memory allocation (cost optimization)"
  type        = number
  default     = 512  # Optimal for most functions
}

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode"
  type        = string
  default     = "ON_DEMAND"  # Simpler than provisioned
}

variable "cloudwatch_retention_days" {
  description = "CloudWatch log retention period"
  type        = number
  default     = 7  # Cost control
}

