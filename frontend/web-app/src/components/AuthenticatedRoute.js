// frontend/web-app/src/components/AuthenticatedRoute.js
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import LoadingSpinner from './LoadingSpinner';

const AuthenticatedRoute = ({ children }) => {
  const { user, checkAuthState, isLoading } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      await checkAuthState();
      setIsChecking(false);
    };
    
    if (isLoading) {
      checkAuth();
    } else {
      setIsChecking(false);
    }
  }, [checkAuthState, isLoading]);

  if (isChecking || isLoading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column'
      }}>
        <h2>Authentication Required</h2>
        <p>Please log in to access this page.</p>
      </div>
    );
  }

  return children;
};

export default AuthenticatedRoute;
