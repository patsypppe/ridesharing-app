# Rideshare — web app

React 18 PWA for the serverless rideshare backend (Cognito + API Gateway + Lambda + DynamoDB).

## Run it locally

```bash
cd frontend/web-app
npm install
npm start          # http://localhost:3000
```

That's it — **no AWS account or deployed infrastructure is required.**

## Demo mode

`.env` ships with `REACT_APP_DEMO_MODE=true`. In this mode the app runs against an
in-browser mock backend (`src/services/mockBackend.js`) instead of AWS:

| Real stack | Demo stand-in |
|---|---|
| Cognito user pool | `mockAuth` — any email, password 8+ chars, session kept in `localStorage` |
| API Gateway → Lambda → DynamoDB | `mockApi` — same routes, same response shapes, same fare formula as `ride-service` |
| API Gateway WebSocket | `createMockSocket` — emits the same `location_update` messages the websocket-service Lambda pushes |

The mock mirrors the real contracts deliberately: the fare maths is copied from
`backend/services/ride-service/handler.js`, and the response envelopes match what the
Lambdas return, so the React code is identical in both modes.

A purple banner across the top makes it obvious when demo mode is on.

### What you can walk through

1. **Sign in** — credentials are prefilled
2. **Dashboard** — ride stats and history
3. **Book a ride** — tap the map for pickup and dropoff, pick a ride type, see the live fare estimate
4. **Track ride** — driver assignment, animated driver marker, staged progress, complete the trip
5. **Driver mode** — register a vehicle, toggle online/offline
6. **Profile** — edit and save, plus a "reset demo data" button

## Switching to the real AWS backend

```bash
cd backend/infrastructure/terraform
terraform init && terraform apply
terraform output          # needs outputs.tf to be populated
```

Then copy `.env.example` to `.env`, set `REACT_APP_DEMO_MODE=false`, and fill in the five
values. `src/config.js` flips every call from the mock to Amplify → Cognito / API Gateway.
Nothing else changes.

## Layout

```
src/
  config.js               demo-vs-AWS switch, read once at startup
  services/
    authProvider.js       single seam over Cognito (Amplify Auth) or the mock
    apiService.js         one method per API Gateway route
    websocketService.js   real API Gateway WebSocket client
    mockBackend.js        in-browser stand-in for all three
  store/                  zustand stores (auth, geolocation)
  components/             Map (Leaflet + OpenStreetMap), NavBar, LoadingSpinner
  pages/                  Login, SignUp, Dashboard, RideBooking, RideTracking, Profile, DriverMode
```

## Notes

- Maps use Leaflet with OpenStreetMap tiles — no API key, no cost.
- If the browser blocks or ignores the location prompt, the app falls back to a default
  area after 5s instead of hanging; you can still tap the map to set your points.
- `src/tests/e2e/user-journey.test.js` predates this scaffold and is not wired up;
  `npm start` and `npm run build` don't touch it.
