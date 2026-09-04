// frontend/web-app/src/App.js
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { useAuthStore } from './store/authStore';
import { useLocationStore } from './store/locationStore';
import { DEMO_MODE, awsEnv } from './config';

// Pages
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import RideBookingPage from './pages/RideBookingPage';
import RideTrackingPage from './pages/RideTrackingPage';
import ProfilePage from './pages/ProfilePage';
import DriverModePage from './pages/DriverModePage';
import LoadingSpinner from './components/LoadingSpinner';

// AWS configuration comes from `terraform output` via .env.
// Skipped entirely in demo mode, where the in-browser mock backend serves the app.
if (!DEMO_MODE) {
  Amplify.configure({
    Auth: {
      region: awsEnv.region,
      userPoolId: awsEnv.userPoolId,
      userPoolWebClientId: awsEnv.userPoolClientId,
      mandatorySignIn: true,
      authenticationFlowType: 'USER_SRP_AUTH',
    },
    API: {
      endpoints: [
        {
          name: 'RideshareAPI',
          endpoint: awsEnv.apiGatewayUrl,
          region: awsEnv.region,
        },
      ],
    },
  });
}

function App() {
  const { user, isLoading, checkAuthState } = useAuthStore();
  const { requestLocationPermission } = useLocationStore();

  useEffect(() => {
    checkAuthState();
    requestLocationPermission();
  }, [checkAuthState, requestLocationPermission]);

  if (isLoading) {
    return <LoadingSpinner label="Checking your session…" />;
  }

  return (
    <Router>
      <div className="app">
        {DEMO_MODE && (
          <div className="demo-banner">
            <strong>Demo mode</strong> — running against an in-browser mock backend. No AWS
            resources are deployed. Fill in <code>.env</code> from <code>terraform output</code> to
            switch to the real Cognito / API Gateway / DynamoDB stack.
          </div>
        )}

        <Routes>
          {!user ? (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/book-ride" element={<RideBookingPage />} />
              <Route path="/track-ride/:rideId" element={<RideTrackingPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/driver-mode" element={<DriverModePage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </>
          )}
        </Routes>
      </div>
    </Router>
  );
}

export default App;
