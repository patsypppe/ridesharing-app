// frontend/web-app/src/services/authProvider.js
//
// Single seam between the app and Cognito. In DEMO_MODE the mock takes over,
// so no component or store needs to know which one is live.

import { Auth } from 'aws-amplify';
import { DEMO_MODE } from '../config';
import { mockAuth } from './mockBackend';

const provider = DEMO_MODE ? mockAuth : Auth;

const authProvider = {
  currentAuthenticatedUser: () => provider.currentAuthenticatedUser(),
  currentSession: () => provider.currentSession(),
  signIn: (email, password) => provider.signIn(email, password),
  signUp: (params) => provider.signUp(params),
  confirmSignUp: (email, code) => provider.confirmSignUp(email, code),
  signOut: () => provider.signOut(),
};

export default authProvider;
