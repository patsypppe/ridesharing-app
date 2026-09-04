variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1" # Cheapest region for most services
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
  default     = 512 # Optimal for most functions
}

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode (PAY_PER_REQUEST is on-demand; PROVISIONED needs read/write capacity)"
  type        = string
  default     = "PAY_PER_REQUEST"

  validation {
    condition     = contains(["PAY_PER_REQUEST", "PROVISIONED"], var.dynamodb_billing_mode)
    error_message = "dynamodb_billing_mode must be PAY_PER_REQUEST or PROVISIONED."
  }
}

variable "cloudwatch_retention_days" {
  description = "CloudWatch log retention period"
  type        = number
  default     = 7 # Cost control
}


# Lambda
variable "lambda_runtime" {
  description = "Node.js runtime for every function. Lambda no longer accepts new nodejs18.x functions."
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_architecture" {
  description = "CPU architecture. arm64 (Graviton) is ~20% cheaper and every dependency here is pure JavaScript."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "lambda_timeout" {
  description = "Default function timeout in seconds (notification-service overrides this in lambda.tf)"
  type        = number
  default     = 10
}

# API Gateway throttling (abuse and cost guard; the free tier is 1M requests/month)
variable "api_throttling_rate_limit" {
  description = "Steady-state requests per second allowed on the HTTP API"
  type        = number
  default     = 50
}

variable "api_throttling_burst_limit" {
  description = "Burst capacity on the HTTP API"
  type        = number
  default     = 100
}

# Secrets and per-service settings. Pass with -var, TF_VAR_*, or a git-ignored *.tfvars.
variable "stripe_secret_key" {
  description = "Stripe secret key for payment-service (test mode only). Empty leaves payments unconfigured."
  type        = string
  default     = ""
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret for POST /payments/webhook"
  type        = string
  default     = ""
  sensitive   = true
}

variable "from_email" {
  description = "SES-verified sender address for notification-service. Required for email; unset makes every SES call fail."
  type        = string
  default     = ""
}
