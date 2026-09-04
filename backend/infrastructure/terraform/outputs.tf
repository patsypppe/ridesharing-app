# Values the CI workflow and frontend/web-app/.env read after `terraform apply`.

output "aws_region" {
  description = "Region the stack is deployed in (REACT_APP_AWS_REGION)"
  value       = var.aws_region
}

output "user_pool_id" {
  description = "Cognito User Pool ID (REACT_APP_USER_POOL_ID, Lambda USER_POOL_ID)"
  value       = aws_cognito_user_pool.user_pool.id
}

output "user_pool_client_id" {
  description = "Cognito app client ID (REACT_APP_USER_POOL_CLIENT_ID, Lambda USER_POOL_CLIENT_ID)"
  value       = aws_cognito_user_pool_client.user_pool_client.id
}

output "api_gateway_url" {
  description = "HTTP API base URL (REACT_APP_API_GATEWAY_URL). Served from the $default stage, so no path prefix."
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}

output "websocket_url" {
  description = "WebSocket URL including its stage (REACT_APP_WEBSOCKET_URL)"
  value       = "${aws_apigatewayv2_api.websocket_api.api_endpoint}/${aws_apigatewayv2_stage.websocket.name}"
}

output "frontend_bucket" {
  description = "S3 bucket to `aws s3 sync build/` into"
  value       = aws_s3_bucket.frontend_hosting.bucket
}

output "cloudfront_distribution_id" {
  description = "For `aws cloudfront create-invalidation` after a frontend deploy"
  value       = aws_cloudfront_distribution.frontend_distribution.id
}

output "cloudfront_domain" {
  description = "Public URL of the frontend"
  value       = aws_cloudfront_distribution.frontend_distribution.domain_name
}

output "event_bus_name" {
  description = "Custom EventBridge bus (Lambda EVENT_BUS_NAME)"
  value       = aws_cloudwatch_event_bus.rideshare_events.name
}

output "dynamodb_tables" {
  description = "Table names for the Lambda environment"
  value = {
    users         = aws_dynamodb_table.users.name
    drivers       = aws_dynamodb_table.drivers.name
    rides         = aws_dynamodb_table.rides.name
    payments      = aws_dynamodb_table.payments.name
    notifications = aws_dynamodb_table.notifications.name
    connections   = aws_dynamodb_table.connections.name
  }
}

# ---- Compute layer -------------------------------------------------------

output "http_routes" {
  description = "HTTP route -> Lambda function name. The deployed answer to 'which function handles this path'."
  value = {
    for route_key, r in local.http_routes :
    route_key => aws_lambda_function.this["${r.service}-${r.handler}"].function_name
  }
}

output "websocket_routes" {
  description = "WebSocket route -> Lambda function name"
  value = {
    for route_key, r in local.websocket_routes :
    route_key => aws_lambda_function.this["${r.service}-${r.handler}"].function_name
  }
}

output "lambda_functions" {
  description = "Every function, keyed by <service>-<handler>. Includes the two with no route (EventBridge and IAM-only)."
  value       = { for key, f in aws_lambda_function.this : key => f.function_name }
}

output "lambda_exec_role_arn" {
  description = "Execution role shared by every function"
  value       = aws_iam_role.lambda_exec.arn
}

output "common_layer_arn" {
  description = "Current version of the shared Lambda layer"
  value       = aws_lambda_layer_version.common.arn
}
