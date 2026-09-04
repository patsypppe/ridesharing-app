# Deploy to AWS — what to add and where

**Status: deployable from a laptop; CI still needs section 5.** Sections 2, 3 and 4 are done in code
(`terraform validate` passes, `terraform plan` shows 132 resources to add, `cd backend && npm test` is
green with 55 tests). Section 5 (CI and the frontend auth header) is still open. Work through the
remaining items in order.

## 1. Credentials (add these, never commit them)

| What | Where |
|---|---|
| AWS access key / secret (local) | `aws configure` → `~/.aws/credentials`. Terraform and the AWS CLI read it automatically. |
| `AWS_ROLE_ARN` (CI) | GitHub repo → Settings → Secrets → Actions. An IAM role trusted for GitHub OIDC. |
| `COST_ALERT_TOPIC_ARN` (CI) | Same place. SNS topic ARN for the cost job. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Terraform variables `stripe_secret_key` / `stripe_webhook_secret` (marked sensitive). Put them in a git-ignored `*.tfvars` or `TF_VAR_stripe_secret_key=...`. Terraform sets them on the payment functions. Test keys only. |
| `FROM_EMAIL` | Terraform variable `from_email`. Must be an SES-verified identity. Terraform sets it on `notification-service`. Leave it unset and every SES call fails; because each notification handler wraps email and SMS in one `try`, the SMS after a failed email is skipped too. |
| `USER_POOL_ID`, `USER_POOL_CLIENT_ID`, table names, `EVENT_BUS_NAME`, `WEBSOCKET_API_ENDPOINT` | Set by Terraform on **every** function from its own resources. Nothing to fill in. `AWS_REGION` is provided by Lambda itself. The backend block of the root `.env.example` (`JWT_SECRET`, `SNS_TOPIC_ARN`, table names) predates this; nothing reads it. |
| Frontend Cognito / API values | `frontend/web-app/.env` — set `REACT_APP_DEMO_MODE=false`, fill the five `REACT_APP_*` lines from `terraform output`. |

Terraform 1.16 is installed on this machine (`terraform version`). On another machine:
`brew tap hashicorp/tap && brew install hashicorp/tap/terraform`.

## 2. `main.tf` validates — DONE, one manual step left

Fixed: `billing_mode` is now `PAY_PER_REQUEST` (via `var.dynamodb_billing_mode`), every GSI has
`projection_type`, CORS no longer combines `allow_credentials = true` with a wildcard origin, the
`error.html` document is gone in favour of CloudFront 403/404 → `/index.html`, and a bucket policy
grants the OAI `s3:GetObject`. `outputs.tf` now exports everything CI and the frontend `.env` need.

- **Remote state (manual).** The `backend "s3"` block is commented out, so `terraform init` uses local
  state. That is fine for your first `plan`/`apply` from a laptop. Before CI runs `apply`, create a
  bucket with a globally unique name, put it in the block, uncomment, and run
  `terraform init -migrate-state`. Steps are in the comment in `main.tf`.

## 3. Compute layer in Terraform — DONE

Three new files next to `main.tf`:

| File | What it declares |
|---|---|
| `lambda.tf` | One execution role and policy (DynamoDB on the six tables and their indexes, `events:PutEvents` on the bus, `sns:Publish`, `ses:SendEmail`, `execute-api:ManageConnections`, logs), the shared layer, a log group with retention per function, and **22 functions, one per handler export**, on `nodejs20.x` / `arm64`. |
| `api_routes.tf` | The route tables. `local.http_routes` maps every path the frontend calls (17 routes) to `{ service, handler }`; `local.websocket_routes` maps `$connect` / `$disconnect` / `$default`. A Cognito JWT authorizer protects every HTTP route except `POST /payments/webhook`, which Stripe signs itself. Stages: `$default` on the HTTP API (so the URL has no path prefix) and `<environment>` on the WebSocket API. |
| `events.tf` | The EventBridge rule on the custom bus that sends the five `detail-type`s notification-service handles to it. |

**How the mapping works.** A route entry such as `"POST /rides" = { service = "ride", handler = "requestRide" }`
produces a function named `rideshare-ride-requestRide-<env>` whose `handler` is `handler.requestRide`,
packaged from `backend/services/ride-service`. Functions are *derived* from the route tables, so a route
cannot point at a function that does not exist. After `apply`, `terraform output http_routes` prints
the deployed route → function table.

**Packaging.** Terraform zips from `backend/build/`, which `backend/scripts/package.sh` stages (layer under
`nodejs/`, each service with its production `node_modules`, aws-sdk stripped since the layer carries it).
Run the script before every `plan` or `apply`; a precondition fails with a clear message if you forget.
The layer zip is about 17 MB, nearly all of it aws-sdk v2.

Also added: the `payments`, `notifications` and `connections` tables, the missing `getRide` handler
(`GET /rides/{rideId}`, rider or assigned driver only, 5 tests). New rides and drivers no longer write
`null` into `driverId` / `locationHash`, which are GSI keys DynamoDB would reject (regression tests added), and outputs `http_routes`,
`websocket_routes`, `lambda_functions`, `lambda_exec_role_arn`, `common_layer_arn`. `websocket_url` now
includes the stage.

- The rides table's `UserRidesIndex` and `DriverRidesIndex` are sorted by `createdAt`, not `status`, so
  ride history really is newest first. Because `driverId` is a GSI key, `requestRide` leaves it absent
  (DynamoDB rejects `null` where the index expects a string); `acceptRide` sets it.
- `websocket-service.broadcast` deliberately has **no route**. It pushes any caller-supplied message to every
  connection and has no auth; invoke it with `aws lambda invoke` (IAM) or from an EventBridge target only.
- Throttling defaults to 50 req/s steady and 100 burst on the HTTP API (`api_throttling_*` variables).

## 4. Lambda code — DONE

Fixed: handlers require `/opt/nodejs/utils` (the path CI actually packages); the layer verifies Cognito
RS256 signatures, issuer, expiry and audience instead of `jwt.decode`; a bad or missing token now returns
**401** instead of 500; `payment-service` imports `dbUpdate`; `user-service` keys profiles by the Cognito
`sub`; `ride-service` checks for rides in `requested/matched/en-route/arrived/in-progress`; the WebSocket
`$connect` handler takes `?token=<idToken>&userType=` and ignores any `userId` in the query string or in
message payloads; `broadcast` uses Scan. Every service and the layer now has a `package.json` and
`package-lock.json` (Stripe is declared on `payment-service`).

Behaviour changes to know about:

- `POST /user/register` now requires a Bearer token. Nothing in the frontend calls it yet, so no
  DynamoDB profile is created after sign-up; either call it after sign-in or add a Cognito
  post-confirmation trigger.
- `backend/package.json` is a test harness: `cd backend && npm ci && npm test`. Tests live in each
  service's `tests/` folder and in `shared/layers/common/tests/`.

## 5. Fix CI and the frontend — TODO

- `.github/workflows/backend-deploy.yml`, `deploy-infrastructure` job: run `backend/scripts/package.sh`
  (after `actions/setup-node`) before `terraform plan`, or the archive preconditions fail.
- Same file, `deploy-lambdas` job: **delete it, or rewrite it.** Terraform now owns the function code and the
  layer. The job's `update-function-code` targets `rideshare-<service>-<env>`, names that no longer exist
  (functions are `rideshare-<service>-<handler>-<env>`), and its separate `publish-layer-version` would
  fight Terraform over which layer version each function uses. With the packaging step above, `terraform apply`
  already deploys new code.
- `.github/workflows/backend-deploy.yml` line 113: replace `location-service` with `websocket-service` (moot if the job is deleted).
- Same file, `test` job: `npm audit --audit-level moderate` fails on aws-sdk v2 itself
  ([GHSA-j965-2qgj-vjmq](https://github.com/advisories/GHSA-j965-2qgj-vjmq)) and on the old `uuid` it pins; fix = migrate to SDK v3.
  Until then use `--audit-level high` or drop the step.
- Same file: `NODE_VERSION: '18'` → `'20'` and `--compatible-runtimes nodejs18.x` → `nodejs20.x`.
- `frontend/web-app/src/App.js` line 31: the Amplify `API` endpoint needs a `custom_header` that returns `Authorization: Bearer <idToken>`. Without it no request carries a token.
- No step deploys the frontend. After `npm run build`, run `aws s3 sync build/ s3://<frontend_bucket>` and `aws cloudfront create-invalidation --distribution-id <cloudfront_distribution_id> --paths '/*'`.

## 6. Order of operations

1. `backend/scripts/package.sh`, then `cd backend/infrastructure/terraform && terraform init && terraform plan`
   (local state is fine here). Expect 132 resources to add on an empty account.
2. `terraform apply` (pass `-var stripe_secret_key=... -var from_email=...` or use a git-ignored tfvars file).
3. Set up remote state (§2), fix §5, push to trigger CI.
4. Verify the SES sender identity, fill `frontend/web-app/.env` from `terraform output`, build, sync to S3, invalidate CloudFront.
