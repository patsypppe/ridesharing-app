# Route tables: which HTTP route or WebSocket route reaches which Lambda.
#
# To answer "which service handles POST /rides", find the route key below and
# read its service and handler. `terraform output http_routes` prints the same
# mapping with the deployed function names. Every path the frontend calls in
# frontend/web-app/src/services/apiService.js is listed here.

locals {
  # `service` selects the package and env vars (see local.services in
  # lambda.tf); `handler` is the export in that service's handler.js.
  # Routes are protected by the Cognito JWT authorizer unless `public = true`.
  http_routes = {
    "POST /user/register"    = { service = "user", handler = "register" }
    "GET /user/profile"      = { service = "user", handler = "getProfile" }
    "PUT /user/profile"      = { service = "user", handler = "updateProfile" }
    "POST /user/switch-type" = { service = "user", handler = "switchUserType" }

    "POST /driver/register"    = { service = "driver", handler = "registerDriver" }
    "PUT /driver/availability" = { service = "driver", handler = "updateAvailability" }
    "GET /driver/profile"      = { service = "driver", handler = "getDriverProfile" }
    "GET /drivers/nearby"      = { service = "driver", handler = "getNearbyDrivers" }

    "POST /rides"                 = { service = "ride", handler = "requestRide" }
    "GET /rides/history"          = { service = "ride", handler = "getRideHistory" }
    "GET /rides/{rideId}"         = { service = "ride", handler = "getRide" }
    "POST /rides/{rideId}/accept" = { service = "ride", handler = "acceptRide" }
    "PUT /rides/{rideId}/status"  = { service = "ride", handler = "updateRideStatus" }
    "GET /rides/{rideId}/fare"    = { service = "payment", handler = "calculateFare" }

    "POST /payments"        = { service = "payment", handler = "processPayment" }
    "GET /payments/history" = { service = "payment", handler = "getPaymentHistory" }
    # Called by Stripe, which signs the body with STRIPE_WEBHOOK_SECRET instead of sending a Cognito token.
    "POST /payments/webhook" = { service = "payment", handler = "stripeWebhook", public = true }
  }

  # The WebSocket API selects a route from `$request.body.action`; anything
  # that is not $connect/$disconnect falls through to $default, where
  # `message` switches on the action itself.
  websocket_routes = {
    "$connect"    = { service = "websocket", handler = "connect" }
    "$disconnect" = { service = "websocket", handler = "disconnect" }
    "$default"    = { service = "websocket", handler = "message" }
  }

  http_function_keys      = toset([for r in values(local.http_routes) : "${r.service}-${r.handler}"])
  websocket_function_keys = toset([for r in values(local.websocket_routes) : "${r.service}-${r.handler}"])
}

# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

# API Gateway verifies the Cognito token before the Lambda runs, and passes the
# claims in event.requestContext.authorizer.jwt.claims; the shared layer's
# authenticate() reads them from there.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http_api.id
  name             = "${var.project_name}-cognito-${var.environment}"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.user_pool_client.id]
    issuer   = "https://${aws_cognito_user_pool.user_pool.endpoint}"
  }
}

# One integration per function; routes point at it.
resource "aws_apigatewayv2_integration" "http" {
  for_each = local.http_function_keys

  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http" {
  for_each = local.http_routes

  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.http["${each.value.service}-${each.value.handler}"].id}"

  authorization_type = try(each.value.public, false) ? "NONE" : "JWT"
  authorizer_id      = try(each.value.public, false) ? null : aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "http" {
  for_each = local.http_function_keys

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# $default stage: the API is served at the bare api_endpoint with no path prefix,
# which is what REACT_APP_API_GATEWAY_URL expects.
resource "aws_apigatewayv2_stage" "http" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      ip               = "$context.identity.sourceIp"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLatency  = "$context.responseLatency"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  default_route_settings {
    throttling_rate_limit  = var.api_throttling_rate_limit
    throttling_burst_limit = var.api_throttling_burst_limit
  }
}

# ---------------------------------------------------------------------------
# WebSocket API
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "websocket" {
  for_each = local.websocket_function_keys

  api_id           = aws_apigatewayv2_api.websocket_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.this[each.key].invoke_arn
}

# No authorizer: browsers cannot set headers on the handshake, so $connect
# verifies the ?token= query parameter itself.
resource "aws_apigatewayv2_route" "websocket" {
  for_each = local.websocket_routes

  api_id    = aws_apigatewayv2_api.websocket_api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.websocket["${each.value.service}-${each.value.handler}"].id}"
}

resource "aws_lambda_permission" "websocket" {
  for_each = local.websocket_function_keys

  statement_id  = "AllowWebSocketApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket_api.execution_arn}/*/*"
}

# Named after the environment, so the client URL is wss://<id>.execute-api.<region>.amazonaws.com/<env>.
resource "aws_apigatewayv2_stage" "websocket" {
  api_id      = aws_apigatewayv2_api.websocket_api.id
  name        = var.environment
  auto_deploy = true
}
