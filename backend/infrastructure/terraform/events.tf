# EventBridge wiring. Services publish domain events on the custom bus through
# the layer's publishEvent() (source "rideshare.app"); this rule fans the ones
# notification-service understands out to it.

locals {
  # Must match the default `source` in backend/shared/layers/common/utils.js.
  event_source = "rideshare.app"

  # The detail-types notification-service switches on.
  notification_event_types = [
    "Ride Requested",
    "Ride Matched",
    "Ride Status Changed",
    "Payment Completed",
    "Driver Registered",
  ]
}

resource "aws_cloudwatch_event_rule" "notifications" {
  name           = "${var.project_name}-notifications-${var.environment}"
  description    = "Route rider, driver and payment events to notification-service"
  event_bus_name = aws_cloudwatch_event_bus.rideshare_events.name

  event_pattern = jsonencode({
    source        = [local.event_source]
    "detail-type" = local.notification_event_types
  })
}

resource "aws_cloudwatch_event_target" "notifications" {
  rule           = aws_cloudwatch_event_rule.notifications.name
  event_bus_name = aws_cloudwatch_event_bus.rideshare_events.name
  target_id      = "notification-service"
  arn            = aws_lambda_function.this["notification-sendNotification"].arn
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["notification-sendNotification"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.notifications.arn
}
