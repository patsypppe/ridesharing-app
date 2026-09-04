// frontend/web-app/src/pages/DashboardPage.js
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import LoadingSpinner from '../components/LoadingSpinner';
import apiService from '../services/apiService';
import { useLocationStore } from '../store/locationStore';

const statusColor = (status) =>
  ({
    requested: 'amber',
    matched: 'blue',
    'en-route': 'blue',
    'in-progress': 'blue',
    completed: 'green',
    cancelled: 'red',
  }[status] || '');

const DashboardPage = () => {
  const navigate = useNavigate();
  const { currentLocation, getCurrentLocation } = useLocationStore();

  const [profile, setProfile] = useState(null);
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [profileRes, historyRes] = await Promise.all([
          apiService.getUserProfile(),
          apiService.getRideHistory(10),
        ]);
        if (cancelled) return;
        setProfile(profileRes.user);
        setRides(historyRes.rides || []);
      } catch (err) {
        console.error('Dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    getCurrentLocation();
    return () => {
      cancelled = true;
    };
  }, [getCurrentLocation]);

  const completed = rides.filter((r) => r.status === 'completed');
  const spent = completed.reduce((sum, r) => sum + (r.actualFare || r.estimatedFare || 0), 0);
  const active = rides.find((r) => !['completed', 'cancelled'].includes(r.status));

  if (loading) return <LoadingSpinner label="Loading your dashboard…" />;

  return (
    <>
      <NavBar />
      <div className="page">
        <h2>Hi {profile?.firstName || 'there'} 👋</h2>
        <p>Here's what's happening with your account.</p>

        <div className="grid grid-3" style={{ marginBottom: 20 }}>
          <div className="stat">
            <div className="stat-value">{rides.length}</div>
            <div className="stat-label">Total rides</div>
          </div>
          <div className="stat">
            <div className="stat-value">${spent.toFixed(2)}</div>
            <div className="stat-label">Total spent</div>
          </div>
          <div className="stat">
            <div className="stat-value" style={{ textTransform: 'capitalize' }}>
              {profile?.userType || 'rider'}
            </div>
            <div className="stat-label">Account type</div>
          </div>
        </div>

        {active && (
          <div className="card">
            <div className="row between">
              <div>
                <h3 style={{ marginBottom: 4 }}>You have an active ride</h3>
                <p style={{ margin: 0 }}>
                  {active.pickupLocation?.address} → {active.dropoffLocation?.address}
                </p>
              </div>
              <button onClick={() => navigate(`/track-ride/${active.rideId}`)}>Track ride</button>
            </div>
          </div>
        )}

        <div className="card">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Book a ride</h3>
            <span className="badge">
              {currentLocation
                ? `${currentLocation.lat.toFixed(3)}, ${currentLocation.lng.toFixed(3)}`
                : 'Locating…'}
            </span>
          </div>
          <p>Pick your points on the map and get a fare estimate before you confirm.</p>
          <button onClick={() => navigate('/book-ride')}>Start booking</button>
        </div>

        <div className="card">
          <h3>Recent rides</h3>
          {rides.length === 0 ? (
            <p style={{ margin: 0 }}>No rides yet — book your first one above.</p>
          ) : (
            rides.map((ride) => (
              <div className="list-item" key={ride.rideId}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>
                    {ride.pickupLocation?.address} → {ride.dropoffLocation?.address}
                  </div>
                  <div className="hint">
                    {new Date(ride.createdAt).toLocaleString()} ·{' '}
                    {(ride.estimatedDistance || 0).toFixed(1)} km · {ride.rideType}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 600 }}>
                    ${(ride.actualFare || ride.estimatedFare || 0).toFixed(2)}
                  </div>
                  <span className={`badge ${statusColor(ride.status)}`}>{ride.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default DashboardPage;
