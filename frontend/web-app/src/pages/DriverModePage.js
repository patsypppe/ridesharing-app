// frontend/web-app/src/pages/DriverModePage.js
import React, { useEffect, useState } from 'react';
import NavBar from '../components/NavBar';
import LoadingSpinner from '../components/LoadingSpinner';
import RideshareMap from '../components/Map';
import apiService from '../services/apiService';
import { useLocationStore } from '../store/locationStore';

const DriverModePage = () => {
  const { currentLocation, getCurrentLocation, startLocationTracking, stopLocationTracking } =
    useLocationStore();

  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    licenseNumber: '',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    licensePlate: '',
    color: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const { driver: existing } = await apiService.getDriverProfile();
        setDriver(existing);
      } catch {
        setDriver(null); // not registered yet — show the registration form
      } finally {
        setLoading(false);
      }
    })();

    getCurrentLocation();
    return () => stopLocationTracking();
  }, [getCurrentLocation, stopLocationTracking]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleRegister = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { driver: created } = await apiService.registerDriver({
        licenseNumber: form.licenseNumber,
        vehicleInfo: {
          make: form.make,
          model: form.model,
          year: Number(form.year),
          licensePlate: form.licensePlate,
          color: form.color,
        },
      });
      setDriver(created);
    } catch (err) {
      console.error('Driver registration failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async () => {
    const next = driver.status === 'available' ? 'offline' : 'available';
    setSaving(true);
    try {
      const { driver: updated } = await apiService.updateDriverAvailability(next);
      setDriver(updated);
      if (next === 'available') startLocationTracking();
      else stopLocationTracking();
    } catch (err) {
      console.error('Availability update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading driver mode…" />;

  return (
    <>
      <NavBar />
      <div className="page">
        <h2>Driver mode</h2>

        {!driver ? (
          <div className="card">
            <h3>Register as a driver</h3>
            <p>Posts to /driver/register — validated by the Joi driver schema in the shared layer.</p>

            <form onSubmit={handleRegister}>
              <div className="field">
                <label htmlFor="license">Driver's license number</label>
                <input id="license" value={form.licenseNumber} onChange={set('licenseNumber')} required />
              </div>

              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="make">Make</label>
                  <input id="make" value={form.make} onChange={set('make')} placeholder="Toyota" required />
                </div>
                <div className="field">
                  <label htmlFor="model">Model</label>
                  <input id="model" value={form.model} onChange={set('model')} placeholder="Camry" required />
                </div>
                <div className="field">
                  <label htmlFor="year">Year</label>
                  <input id="year" type="number" min="2000" max={new Date().getFullYear()} value={form.year} onChange={set('year')} required />
                </div>
                <div className="field">
                  <label htmlFor="color">Color</label>
                  <input id="color" value={form.color} onChange={set('color')} placeholder="Silver" required />
                </div>
              </div>

              <div className="field">
                <label htmlFor="plate">License plate</label>
                <input id="plate" value={form.licensePlate} onChange={set('licensePlate')} required />
              </div>

              <button type="submit" disabled={saving}>
                {saving ? 'Registering…' : 'Register'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="row between">
                <div>
                  <h3 style={{ marginBottom: 4 }}>
                    You're {driver.status === 'available' ? 'online' : 'offline'}
                  </h3>
                  <p style={{ margin: 0 }}>
                    {driver.status === 'available'
                      ? 'Your geohash is being written to the drivers table — you can be matched.'
                      : 'Go online to start receiving ride requests.'}
                  </p>
                </div>
                <button
                  className={driver.status === 'available' ? 'danger' : ''}
                  onClick={toggleAvailability}
                  disabled={saving}
                >
                  {driver.status === 'available' ? 'Go offline' : 'Go online'}
                </button>
              </div>
            </div>

            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <div className="stat">
                <div className="stat-value">{driver.totalRides ?? 0}</div>
                <div className="stat-label">Rides completed</div>
              </div>
              <div className="stat">
                <div className="stat-value">★ {driver.rating?.toFixed(1) ?? '5.0'}</div>
                <div className="stat-label">Rating</div>
              </div>
              <div className="stat">
                <div className="stat-value" style={{ textTransform: 'capitalize' }}>{driver.status}</div>
                <div className="stat-label">Status</div>
              </div>
            </div>

            <div className="card">
              <h3>Vehicle</h3>
              <div className="list-item">
                <span className="hint">Car</span>
                <span>
                  {driver.vehicleInfo?.year} {driver.vehicleInfo?.color} {driver.vehicleInfo?.make}{' '}
                  {driver.vehicleInfo?.model}
                </span>
              </div>
              <div className="list-item">
                <span className="hint">Plate</span>
                <code>{driver.vehicleInfo?.licensePlate}</code>
              </div>
              <div className="list-item">
                <span className="hint">License</span>
                <code>{driver.licenseNumber}</code>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <RideshareMap center={currentLocation} height="300px" />
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default DriverModePage;
