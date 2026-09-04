# Serverless Ride-Sharing Backend

**A ride-sharing backend built as six Lambda-backed services behind AWS managed infrastructure, with
the environment declared in Terraform.**

Ride hailing is the textbook always-on backend, which normally means paying for servers that sit idle
between requests. This is the same system built so that nothing runs between rides: HTTP API Gateway in
front of Lambda, DynamoDB on-demand for state, a separate WebSocket API for live location, and Cognito
for auth.

> **Status: architecture and service-layer study, not a deployed product.** The service handlers, the
> shared Lambda layer, the tests, and the CI workflow are written and readable. The Terraform stack is
> incomplete: it provisions the data and edge layer but does not yet declare the Lambda functions, the
> API routes, or the IAM roles, so the system does not currently deploy end to end. The exact gaps are
> listed under [Current limitations](#current-limitations). There is no live demo.

---

## Who this is for

Anyone reading the repository to see how a serverless backend is decomposed: where the service
boundaries fall, what goes in a shared layer, how a WebSocket API sits alongside a request/response API,
and what the infrastructure looks like as code rather than as console screenshots.

---

## Architecture

```mermaid
flowchart TB
    PWA["React web app<br/>Amplify · Leaflet · Zustand"]
    PWA --> CF["CloudFront + S3<br/>static hosting"]
    PWA --> HTTP["API Gateway<br/>HTTP API"]
    PWA <--> WS["API Gateway<br/>WebSocket API"]

    HTTP --> USER["user-service"]
    HTTP --> DRIVER["driver-service"]
    HTTP --> RIDE["ride-service"]
    HTTP --> PAY["payment-service"]
    WS --> SOCK["websocket-service"]

    USER --> LAYER["shared Lambda layer<br/>auth · responses · DynamoDB client"]
    DRIVER --> LAYER
    RIDE --> LAYER
    PAY --> LAYER
    SOCK --> LAYER

    LAYER --> DDB[("DynamoDB<br/>users · drivers · rides<br/>payments · notifications · connections")]
    USER --> COG["Cognito user pool"]
    PAY --> STRIPE["Stripe (test mode)"]
    RIDE --> EB["EventBridge bus"]
    EB --> NOTIF["notification-service"]
    NOTIF --> SNS["SNS"]
```

Every function writes to a CloudWatch log group with 7 day retention, omitted from the diagram because
it connects to everything.

### Services

| Service | Lines | Responsibility |
|---|---:|---|
| `user-service` | 182 | Registration, profile, token validation |
| `driver-service` | 301 | Driver registration and availability |
| `ride-service` | 389 | Ride matching and status transitions |
| `payment-service` | 374 | Fare calculation and Stripe charges (test mode) |
| `notification-service` | 431 | Event-driven email and SMS via SNS |
| `websocket-service` | 296 | Connection lifecycle and live location broadcast |

All six share `backend/shared/layers/common/utils.js`, which provides the response envelope, JWT
validation, and a DynamoDB DocumentClient configured with three retries and a 5 second timeout, plus SNS
and EventBridge clients.

---

## Engineering decisions

**HTTP API rather than REST API.** API Gateway's HTTP API is roughly 70% cheaper per million requests
than the REST API at AWS list pricing, and this workload needs none of the REST-only features (request
validation happens in the handlers with Joi, and there are no usage plans or API keys). This is a
pricing-model choice, not a measured saving on this project.

**On-demand DynamoDB, no provisioned capacity.** A portfolio-scale workload has no steady traffic to
provision for, and on-demand costs nothing when idle. Access patterns drove the GSIs rather than the
other way around.

**A separate WebSocket API instead of polling.** Live driver location is a push problem. Polling a REST
endpoint every few seconds would dominate the request count and therefore the bill.

**A shared Lambda layer instead of duplicating helpers.** Auth and the response envelope must behave
identically in all six services, and copies drift.

**EventBridge between ride and notification.** Notifications should not be on the critical path of a
ride status change. The ride service emits an event and returns.

**CloudWatch log retention set to 7 days.** Logs are the quiet cost line in serverless. Retention is set
deliberately rather than left at "never expire".

---

## Technology stack

**Backend** Node.js, AWS Lambda, DynamoDB, API Gateway v2 (HTTP and WebSocket), Cognito, EventBridge,
SNS, CloudWatch Logs, Stripe (test mode), Joi, jsonwebtoken

**Frontend** React 18, AWS Amplify, Leaflet, Zustand, Workbox

**Infrastructure** Terraform, S3, CloudFront

**CI** GitHub Actions with OIDC role assumption (no long-lived AWS keys)

**Testing** Jest with `aws-sdk-mock`, Playwright, boto3 for the cost monitor

---

## Repository layout

```
backend/
  services/<name>-service/handler.js   six Lambda handlers (22 exported functions)
  services/<name>-service/tests/       Jest unit tests per service
  shared/layers/common/                shared Lambda layer (+ tests)
  scripts/package.sh                   stages layer + services for Terraform
  infrastructure/terraform/            main.tf (platform), lambda.tf, api_routes.tf, events.tf
  infrastructure/monitoring/           CloudWatch dashboard definition
  infrastructure/scripts/cost-monitor.py
frontend/web-app/                      React client
.github/workflows/backend-deploy.yml   test → infra → lambdas → integration → cost
```

---

## Local setup

```bash
git clone https://github.com/patsypppe/serverless-rideshare-aws.git
cd serverless-rideshare-aws
cp .env.example .env
```

Inspect the infrastructure without applying it. This needs Terraform and AWS credentials configured, and
it creates nothing:

```bash
cd backend/infrastructure/terraform
terraform init
terraform validate
terraform plan
```

Run the cost monitor against your own account (read-only, requires Cost Explorer permissions):

```bash
pip install boto3
python backend/infrastructure/scripts/cost-monitor.py
```

The frontend and the Node test suite are **not currently runnable from a clean clone**. See
[Current limitations](#current-limitations).

---

## Environment variables

Copy `.env.example` and fill it in. Nothing secret belongs in the repository.

| Variable | Used by | Notes |
|---|---|---|
| `*_TABLE`, `EVENT_BUS_NAME`, `USER_POOL_ID`, `USER_POOL_CLIENT_ID`, `WEBSOCKET_API_ENDPOINT` | all services | Set by Terraform on every function; nothing to fill in |
| `stripe_secret_key`, `stripe_webhook_secret` | payment-service | Terraform variables (`TF_VAR_*`), Stripe **test** keys |
| `from_email` | notification-service | Terraform variable; must be an SES-verified sender |
| `REACT_APP_AWS_REGION` | frontend | |
| `REACT_APP_USER_POOL_ID`, `REACT_APP_USER_POOL_CLIENT_ID` | frontend | Cognito |
| `REACT_APP_API_GATEWAY_URL`, `REACT_APP_WEBSOCKET_URL` | frontend | |

CI additionally expects the repository secret `AWS_ROLE_ARN`, an IAM role trusted for GitHub OIDC.

---

## Current limitations

These are real gaps, listed so nobody has to discover them by cloning.

- **The system has never been deployed.** Terraform validates and plans cleanly (132 resources), but
  there is no live URL, no remote state, and no CI run to point at. Any performance, uptime, or
  monthly-cost figure would be invented, so none is quoted here.
- **CI does not match the Terraform yet.** `backend-deploy.yml` still tries to update functions by a
  naming scheme that no longer exists and publishes the Lambda layer separately from Terraform. The
  fixes are listed in `docs/DEPLOY.md` §5.
- **The frontend never sends its token.** The Amplify `API` config needs a `custom_header` returning
  `Authorization: Bearer <idToken>`; until then every authenticated route returns 401.
- **No profile is created after sign-up.** `POST /user/register` needs a Bearer token and nothing calls
  it yet; a post-confirmation trigger or a call after first sign-in is still to do.
- **aws-sdk v2 is end-of-life.** It ships in the shared layer (most of its 17 MB) and fails
  `npm audit` at the moderate level. Migrating to SDK v3 is the fix.

---

## Roadmap

In dependency order, since each unblocks the next:

1. Fix the CI workflow to run `backend/scripts/package.sh` and let Terraform own the function code.
2. Send the Cognito ID token from the frontend and create the user profile after sign-up.
3. Deploy, then wire the frontend build into CI (S3 sync + CloudFront invalidation).
4. Migrate the shared layer from aws-sdk v2 to v3.

---

## License

MIT. See [LICENSE](LICENSE).
