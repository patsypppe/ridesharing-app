// frontend/web-app/src/pages/RideTrackingPage.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import NavBar from '../components/NavBar';
import LoadingSpinner from '../components/LoadingSpinner';
import RideshareMap from '../components/Map';
import apiService from '../services/apiService';
import websocketService from '../services/websocketService';
import { createMockSocket } from '../services/mockBackend';
import { DEMO_MODE } from '../config';

const STAGES = [
  { key: 'requested', label: 'Finding a driver' },
  { key: 'matched', label: 'Driver assigned' },
  { key: 'en-route', label: 'Driver on the way' },
  { key: 'in-progress', label: 'On the trip' },
  { key: 'completed', label: 'Completed' },
];

const RideTrackingPage = () => {
  const { rideId } = useParams();
  const navigate = useNavigate();

  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const advance = useCallback(async (status) => {
    const { ride: updated } = await apiService.updateRideStatus(rideId, status);
    setRide(updated);
    return updated;
  }, [rideId]);

  // Load the ride, then open the live channel.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { ride: loaded } = await apiService.getRide(rideId);
        if (cancelled) return;
        setRide(loaded);

        if (DEMO_MODE) {
          // Stand-in for the API Gateway WebSocket: same message shapes,
          // driven locally so the flow is demoable with nothing deployed.
          const socket = createMockSocket();
          socketRef.current = socket;
          setConnected(true);

          socket.on('location_update', (msg) => setDriverLocation(msg.location));

          // Match a driver, then walk them to the pickup point.
          const matched = await apiService.updateRideStatus(rideId, 'matched');
          if (cancelled) return;
          setRide(matched.ride);

          const start = {
            lat: loaded.pickupLocation.lat + 0.012,
            lng: loaded.pickupLocation.lng + 0.009,
          };
          setDriverLocation(start);
          socket.simulateApproach(start, loaded.pickupLocation, { steps: 25, intervalMs: 700 });

          setTimeout(() => !cancelled && advance('en-route').catch(() => {}), 1500);
        } else {
          await websocketService.connect(loaded.userId, 'rider');
          setConnected(true);
          websocketService.on('location_update', (msg) => setDriverLocation(msg.location));
          websocketService.on('ride_status_update', (msg) =>
            setRide((r) => (r ? { ...r, status: msg.status } : r))
          );
        }
      } catch (err) {
        console.error('Ride tracking failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (socketRef.current) socketRef.current.disconnect();
      else websocketService.disconnect();
    };
  }, [rideId, advance]);

  if (loading) return <LoadingSpinner label="Connecting to your ride…" />;

  if (!ride) {
    return (
      <>
        <NavBar />
        <div className="page">
          <div className="card">
            <h3>Ride not found</h3>
            <p>We couldn't load ride {rideId}.</p>
            <button onClick={() => navigate('/dashboard')}>Back to dashboard</button>
          </div>
        </div>
      </>
    );
  }

  const stageIndex = Math.max(0, STAGES.findIndex((s) => s.key === ride.status));
  const isDone = ride.status === 'completed';

  return (
    <>
      <NavBar />
      <div className="page">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Your ride</h2>
          <span className={`badge ${connected ? 'green' : 'red'}`}>
            {connected ? 'Live · WebSocket' : 'Disconnected'}
          </span>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <RideshareMap
            center={driverLocation || ride.pickupLocation}
            pickupLocation={ride.pickupLocation}
            dropoffLocation={ride.dropoffLocation}
            showRoute
            markers={
              driverLocation
                ? [{
                    id: 'driver',
                    lat: driverLocation.lat,
                    lng: driverLocation.lng,
                    title: ride.driver?.name || 'Your driver',
                    description: ride.driver
                      ? `${ride.driver.vehicleInfo.color} ${ride.driver.vehicleInfo.make} ${ride.driver.vehicleInfo.model}`
                      : undefined,
                  }]
                : []
            }
            height="340px"
          />
        </div>

        <div className="card">
          <h3>Progress</h3>
          {STAGES.map((stage, i) => (
            <div className="list-item" key={stage.key}>
              <div className="row">
                <span
                  style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 11,
                    background: i <= stageIndex ? 'var(--accent)' : 'var(--surface-2)',
                    color: i <= stageIndex ? '#fff' : 'var(--muted)',
                  }}
                >
                  {i < stageIndex ? '✓' : i + 1}
                </span>
                <span style={{ color: i <= stageIndex ? 'var(--text)' : 'var(--muted)' }}>
                  {stage.label}
                </span>
              </div>
              {i === stageIndex && <span className="badge blue">Current</span>}
            </div>
          ))}
        </div>

        {ride.driver && (
          <div className="card">
            <h3>Your driver</h3>
            <div className="list-item">
              <span>{ride.driver.name}</span>
              <span className="badge amber">★ {ride.driver.rating}</span>
            </div>
            <div className="list-item">
              <span className="hint">Vehicle</span>
              <span>
                {ride.driver.vehicleInfo.color} {ride.driver.vehicleInfo.make}{' '}
                {ride.driver.vehicleInfo.model}
              </span>
            </div>
            <div className="list-item">
              <span className="hint">Plate</span>
              <code>{ride.driver.vehicleInfo.licensePlate}</code>
            </div>
          </div>
        )}

        <div className="card">
          <h3>Trip details</h3>
          <div className="list-item">
            <span className="hint">From</span>
            <span>{ride.pickupLocation.address}</span>
          </div>
          <div className="list-item">
            <span className="hint">To</span>
            <span>{ride.dropoffLocation.address}</span>
          </div>
          <div className="list-item">
            <span className="hint">Distance</span>
            <span>{(ride.estimatedDistance || 0).toFixed(2)} km</span>
          </div>
          <div className="list-item">
            <span className="hint">{isDone ? 'Final fare' : 'Estimated fare'}</span>
            <strong>${(ride.actualFare || ride.estimatedFare || 0).toFixed(2)}</strong>
          </div>
          <div className="list-item">
            <span className="hint">Ride ID</span>
            <code style={{ fontSize: 12 }}>{ride.rideId}</code>
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {ride.status === 'en-route' && (
            <button onClick={() => advance('in-progress')}>Start trip</button>
          )}
          {ride.status === 'in-progress' && (
            <button onClick={() => advance('completed')}>Complete trip</button>
          )}
          {!isDone && ride.status !== 'in-progress' && (
            <button className="secondary" onClick={() => advance('cancelled').then(() => navigate('/dashboard'))}>
              Cancel ride
            </button>
          )}
          <button className="ghost" onClick={() => navigate('/dashboard')}>Back to dashboard</button>
        </div>

        {DEMO_MODE && (
          <p className="hint" style={{ marginTop: 14 }}>
            Demo mode — the driver marker is driven by a local stand-in that emits the same
            <code> location_update </code> messages the websocket-service Lambda pushes through
            API Gateway's <code>postToConnection</code>.
          </p>
        )}
      </div>
    </>
  );
};

export default RideTrackingPage;
