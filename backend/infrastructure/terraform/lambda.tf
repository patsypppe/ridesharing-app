# Compute layer: one execution role, the shared layer, and one Lambda per
# handler export. Which route reaches which function is declared in
# api_routes.tf (HTTP and WebSocket) and events.tf (EventBridge).
#
# Packages come from backend/build/, staged by backend/scripts/package.sh.
# Run that script before `terraform plan`; the preconditions below say so
# if it was skipped.

data "aws_caller_identity" "current" {}

locals {
  build_dir = abspath("${path.module}/../../build")

  # One zip per service folder. Every function of a service shares it and
  # differs only in its `handler` string.
  services = {
    user         = { dir = "user-service" }
    driver       = { dir = "driver-service" }
    ride         = { dir = "ride-service" }
    payment      = { dir = "payment-service" }
    notification = { dir = "notification-service", timeout = 30 } # SES + SNS round trips
    websocket    = { dir = "websocket-service" }
  }

  # Functions with no API route: invoked by EventBridge, or by IAM only.
  # websocket-broadcast pushes any caller-supplied message to every open
  # connection and has no auth of its own, so it must never get a public route.
  unrouted_functions = {
    "notification-sendNotification" = { service = "notification", handler = "sendNotification" }
    "websocket-broadcast"           = { service = "websocket", handler = "broadcast" }
  }

  # Every routed function, derived from the route tables so a route can never
  # point at a function that does not exist. Grouping (`...`) lets two routes
  # share one handler.
  routed_function_groups = {
    for route_key, r in merge(local.http_routes, local.websocket_routes) :
    "${r.service}-${r.handler}" => { service = r.service, handler = r.handler }...
  }
  routed_functions = { for key, group in local.routed_function_groups : key => group[0] }

  lambda_functions = merge(local.routed_functions, local.unrouted_functions)

  # e.g. rideshare-ride-requestRide-prod
  function_names = {
    for key, f in local.lambda_functions : key => "${var.project_name}-${key}-${var.environment}"
  }

  tables = [
    aws_dynamodb_table.users,
    aws_dynamodb_table.drivers,
    aws_dynamodb_table.rides,
    aws_dynamodb_table.payments,
    aws_dynamodb_table.notifications,
    aws_dynamodb_table.connections,
  ]
  table_arns = [for t in local.tables : t.arn]

  # The management endpoint websocket-service pushes through. Built from the
  # API id and the stage name (not the stage resource) to avoid a dependency
  # cycle: function -> stage -> route -> integration -> function.
  websocket_management_endpoint = "https://${aws_apigatewayv2_api.websocket_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"

  # AWS_REGION is reserved: Lambda sets it itself.
  common_env = {
    USERS_TABLE            = aws_dynamodb_table.users.name
    DRIVERS_TABLE          = aws_dynamodb_table.drivers.name
    RIDES_TABLE            = aws_dynamodb_table.rides.name
    PAYMENTS_TABLE         = aws_dynamodb_table.payments.name
    NOTIFICATIONS_TABLE    = aws_dynamodb_table.notifications.name
    CONNECTIONS_TABLE      = aws_dynamodb_table.connections.name
    EVENT_BUS_NAME         = aws_cloudwatch_event_bus.rideshare_events.name
    WEBSOCKET_API_ENDPOINT = local.websocket_management_endpoint
    USER_POOL_ID           = aws_cognito_user_pool.user_pool.id
    USER_POOL_CLIENT_ID    = aws_cognito_user_pool_client.user_pool_client.id
  }

  service_env = {
    payment = {
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
    }
    notification = {
      FROM_EMAIL = var.from_email
    }
  }
}

# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------

data "archive_file" "layer" {
  type        = "zip"
  source_dir  = "${local.build_dir}/layer"
  output_path = "${local.build_dir}/layer.zip"

  lifecycle {
    precondition {
      condition     = fileexists("${local.build_dir}/layer/nodejs/utils.js")
      error_message = "Lambda layer is not staged. Run backend/scripts/package.sh first."
    }
  }
}

data "archive_file" "service" {
  for_each = local.services

  type        = "zip"
  source_dir  = "${local.build_dir}/${each.value.dir}"
  output_path = "${local.build_dir}/${each.value.dir}.zip"

  lifecycle {
    precondition {
      condition     = fileexists("${local.build_dir}/${each.value.dir}/handler.js")
      error_message = "${each.value.dir} is not staged. Run backend/scripts/package.sh first."
    }
  }
}

# aws-sdk v2, Cognito JWT verification, DynamoDB helpers and Joi schemas,
# mounted at /opt/nodejs so handlers can `require('/opt/nodejs/utils')`.
resource "aws_lambda_layer_version" "common" {
  layer_name               = "${var.project_name}-common-layer-${var.environment}"
  description              = "Shared utilities for the rideshare services"
  filename                 = data.archive_file.layer.output_path
  source_code_hash         = data.archive_file.layer.output_base64sha256
  compatible_runtimes      = [var.lambda_runtime]
  compatible_architectures = [var.lambda_architecture]
}

# ---------------------------------------------------------------------------
# Execution role
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.project_name}-lambda-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_exec" {
  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for lg in aws_cloudwatch_log_group.lambda : "${lg.arn}:*"]
  }

  statement {
    sid = "Tables"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = concat(local.table_arns, [for arn in local.table_arns : "${arn}/index/*"])
  }

  statement {
    sid       = "PublishDomainEvents"
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.rideshare_events.arn]
  }

  # SMS publishes carry a phone number, not a topic, so there is no ARN to scope to.
  statement {
    sid       = "SendSms"
    actions   = ["sns:Publish"]
    resources = ["*"]
  }

  statement {
    sid       = "SendEmail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/*"]
  }

  statement {
    sid       = "PushToWebSocketClients"
    actions   = ["execute-api:ManageConnections"]
    resources = ["${aws_apigatewayv2_api.websocket_api.execution_arn}/*"]
  }
}

resource "aws_iam_role_policy" "lambda_exec" {
  name   = "${var.project_name}-lambda-exec-${var.environment}"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec.json
}

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

# Created ahead of the function so retention applies from the first invocation.
resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/${local.function_names[each.key]}"
  retention_in_days = var.cloudwatch_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.lambda_functions

  function_name = local.function_names[each.key]
  description   = "${local.services[each.value.service].dir} handler.${each.value.handler}"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.${each.value.handler}"
  runtime       = var.lambda_runtime
  architectures = [var.lambda_architecture]
  memory_size   = var.lambda_memory_size
  timeout       = try(local.services[each.value.service].timeout, var.lambda_timeout)

  filename         = data.archive_file.service[each.value.service].output_path
  source_code_hash = data.archive_file.service[each.value.service].output_base64sha256
  layers           = [aws_lambda_layer_version.common.arn]

  # Unset secrets are dropped rather than passed as "" so the handlers' own
  # "is it configured" checks keep working. Only service_env is filtered: its
  # values are plain variables, so the resulting keys stay known at plan time.
  environment {
    variables = merge(
      local.common_env,
      { for k, v in try(local.service_env[each.value.service], {}) : k => v if v != "" },
    )
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_exec,
  ]
}
