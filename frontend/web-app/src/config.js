// frontend/web-app/src/config.js
//
// One switch decides whether the app talks to real AWS or to the in-browser
// mock backend. DEMO_MODE is true when either:
//   - REACT_APP_DEMO_MODE=true is set, or
//   - no Cognito User Pool has been configured (i.e. Terraform hasn't been applied)
//
// This lets the UI be demoed on a laptop with zero AWS resources deployed,
// while flipping to the real backend the moment the .env values are filled in
// from `terraform output`.

export const awsEnv = {
  region: process.env.REACT_APP_AWS_REGION,
  userPoolId: process.env.REACT_APP_USER_POOL_ID,
  userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
  apiGatewayUrl: process.env.REACT_APP_API_GATEWAY_URL,
  websocketUrl: process.env.REACT_APP_WEBSOCKET_URL,
};

const explicitDemo = String(process.env.REACT_APP_DEMO_MODE).toLowerCase() === 'true';
const hasCognito = Boolean(awsEnv.userPoolId && awsEnv.userPoolClientId && awsEnv.region);

export const DEMO_MODE = explicitDemo || !hasCognito;

// Any email/password works in demo mode, but these are prefilled for convenience.
export const DEMO_CREDENTIALS = {
  email: 'demo@rideshare.dev',
  password: 'Demo1234!',
};
