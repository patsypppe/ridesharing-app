// frontend/web-app/src/pages/ProfilePage.js
import React, { useEffect, useState } from 'react';
import NavBar from '../components/NavBar';
import LoadingSpinner from '../components/LoadingSpinner';
import apiService from '../services/apiService';
import { DEMO_MODE } from '../config';
import { resetDemoData } from '../services/mockBackend';

const ProfilePage = () => {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { user } = await apiService.getUserProfile();
        setProfile(user);
        setForm({
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          phoneNumber: user.phoneNumber || '',
        });
      } catch (err) {
        console.error('Profile load failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiService.updateProfile(form);
      setSaved(true);
    } catch (err) {
      console.error('Profile save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    resetDemoData();
    window.location.href = '/login';
  };

  if (loading) return <LoadingSpinner label="Loading profile…" />;

  return (
    <>
      <NavBar />
      <div className="page">
        <h2>Profile</h2>
        <p>Updates go to PUT /user/profile, handled by the user-service Lambda.</p>

        <div className="card">
          <form onSubmit={handleSave}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="fn">First name</label>
                <input id="fn" value={form.firstName} onChange={set('firstName')} />
              </div>
              <div className="field">
                <label htmlFor="ln">Last name</label>
                <input id="ln" value={form.lastName} onChange={set('lastName')} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="phone">Phone number</label>
              <input id="phone" value={form.phoneNumber} onChange={set('phoneNumber')} placeholder="+15551234567" />
              <p className="hint" style={{ marginTop: 6 }}>
                Validated server-side against E.164 by the Joi schema in the shared Lambda layer.
              </p>
            </div>

            <div className="row">
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && <span className="badge green">Saved</span>}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>Account</h3>
          <div className="list-item">
            <span className="hint">Email</span>
            <span>{profile?.email}</span>
          </div>
          <div className="list-item">
            <span className="hint">User ID (Cognito sub)</span>
            <code style={{ fontSize: 12 }}>{profile?.userId}</code>
          </div>
          <div className="list-item">
            <span className="hint">Account type</span>
            <span className="badge blue">{profile?.userType}</span>
          </div>
          <div className="list-item">
            <span className="hint">Member since</span>
            <span>{new Date(profile?.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {DEMO_MODE && (
          <div className="card">
            <h3>Demo data</h3>
            <p>Clears the mock rides, driver registration and session from localStorage.</p>
            <button className="danger" onClick={handleReset}>Reset demo data</button>
          </div>
        )}
      </div>
    </>
  );
};

export default ProfilePage;
