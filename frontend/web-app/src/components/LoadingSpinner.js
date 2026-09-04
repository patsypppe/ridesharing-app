// frontend/web-app/src/components/LoadingSpinner.js
import React from 'react';

const LoadingSpinner = ({ label = 'Loading…' }) => (
  <div className="spinner-wrap">
    <div className="spinner" />
    <div>{label}</div>
  </div>
);

export default LoadingSpinner;
