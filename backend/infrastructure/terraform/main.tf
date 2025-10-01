# Configure Terraform and AWS Provider
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    # Configure after initial setup
    bucket = "rideshare-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "RideshareApp"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# S3 Bucket for Frontend Hosting
resource "aws_s3_bucket" "frontend_hosting" {
  bucket = "${var.project_name}-frontend-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "frontend_pab" {
  bucket = aws_s3_bucket.frontend_hosting.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_website_configuration" "frontend_website" {
  bucket = aws_s3_bucket.frontend_hosting.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

# CloudFront Distribution (Cost Optimization)
resource "aws_cloudfront_distribution" "frontend_distribution" {
  origin {
    domain_name = aws_s3_bucket.frontend_hosting.bucket_regional_domain_name
    origin_id   = "S3-${aws_s3_bucket.frontend_hosting.id}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  
  # Cost optimization: Use only required edge locations
  price_class = "PriceClass_100"  # US, Canada, Europe

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend_hosting.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_cloudfront_origin_access_identity" "oai" {
  comment = "OAI for ${var.project_name} frontend"
}

# DynamoDB Tables (On-Demand for Cost Optimization)
resource "aws_dynamodb_table" "users" {
  name           = "${var.project_name}-users-${var.environment}"
  billing_mode   = "ON_DEMAND"  # Cost optimization vs provisioned
  hash_key       = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name     = "EmailIndex"
    hash_key = "email"
  }

  tags = {
    Name = "Users Table"
  }
}

resource "aws_dynamodb_table" "drivers" {
  name         = "${var.project_name}-drivers-${var.environment}"
  billing_mode = "ON_DEMAND"
  hash_key     = "driverId"

  attribute {
    name = "driverId"
    type = "S"
  }

  attribute {
    name = "locationHash"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name     = "LocationIndex"
    hash_key = "locationHash"
  }

  global_secondary_index {
    name     = "StatusIndex"
    hash_key = "status"
  }

  tags = {
    Name = "Drivers Table"
  }
}

resource "aws_dynamodb_table" "rides" {
  name         = "${var.project_name}-rides-${var.environment}"
  billing_mode = "ON_DEMAND"
  hash_key     = "rideId"

  attribute {
    name = "rideId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "driverId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name     = "UserRidesIndex"
    hash_key = "userId"
    range_key = "status"
  }

  global_secondary_index {
    name     = "DriverRidesIndex"
    hash_key = "driverId" 
    range_key = "status"
  }

  tags = {
    Name = "Rides Table"
  }
}

# Cognito User Pool (Free Tier Optimization)
resource "aws_cognito_user_pool" "user_pool" {
  name = "${var.project_name}-users-${var.environment}"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  tags = {
    Name = "User Pool"
  }
}

resource "aws_cognito_user_pool_client" "user_pool_client" {
  name         = "${var.project_name}-client-${var.environment}"
  user_pool_id = aws_cognito_user_pool.user_pool.id

  generate_secret                      = false  # Required for frontend apps
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "http://localhost:3000/callback",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}/callback"
  ]

  logout_urls = [
    "http://localhost:3000",
    "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
  ]
}

# API Gateway HTTP API (70% Cost Savings vs REST)
resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"  # Cost optimization over REST API
  
  cors_configuration {
    allow_credentials = true
    allow_headers     = ["content-type", "authorization"]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_origins     = ["*"]
    expose_headers    = ["date", "keep-alive"]
    max_age          = 86400
  }

  tags = {
    Name = "HTTP API Gateway"
  }
}

# WebSocket API for Real-time Features
resource "aws_apigatewayv2_api" "websocket_api" {
  name          = "${var.project_name}-websocket-${var.environment}"
  protocol_type = "WEBSOCKET"
  route_selection_expression = "$request.body.action"

  tags = {
    Name = "WebSocket API"
  }
}

# EventBridge Custom Bus for Service Communication
resource "aws_cloudwatch_event_bus" "rideshare_events" {
  name = "${var.project_name}-events-${var.environment}"

  tags = {
    Name = "Rideshare Event Bus"
  }
}

# SNS Topic for Notifications
resource "aws_sns_topic" "notifications" {
  name = "${var.project_name}-notifications-${var.environment}"

  tags = {
    Name = "Notifications Topic"
  }
}

# CloudWatch Log Groups with Retention (Cost Control)
resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${aws_apigatewayv2_api.http_api.name}"
  retention_in_days = 7  # Cost optimization - short retention

  tags = {
    Name = "API Gateway Logs"
  }
}
