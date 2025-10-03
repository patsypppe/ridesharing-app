// frontend/web-app/src/App.js
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { useAuthStore } from './store/authStore';
import { useLocationStore } from './store/locationStore';

// Components
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import RideBookingPage from './pages/RideBookingPage';
import RideTrackingPage from './pages/RideTrackingPage';
import ProfilePage from './pages/ProfilePage';
import DriverModePage from './pages/DriverModePage';
import LoadingSpinner from './components/LoadingSpinner';

// AWS Configuration (from Terraform outputs)
const awsConfig = {
  Auth: {
    region: process.env.REACT_APP_AWS_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
    mandatorySignIn: true,
    authenticationFlowType: 'USER_SRP_AUTH'
  },
  API: {
    endpoints: [
      {
        name: 'RideshareAPI',
        endpoint: process.env.REACT_APP_API_GATEWAY_URL,
        region: process.env.REACT_APP_AWS_REGION
      }
    ]
  }
};

Amplify.configure(awsConfig);

function App() {
  const { user, isLoading, checkAuthState } = useAuthStore();
  const { requestLocationPermission } = useLocationStore();

  useEffect(() => {
    checkAuthState();
    requestLocationPermission();
  }, [checkAuthState, requestLocationPermission]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <Router>
      <div className="App">
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
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </>
          )}
        </Routes>
      </div>
    </Router>
  );
}

export default App;
