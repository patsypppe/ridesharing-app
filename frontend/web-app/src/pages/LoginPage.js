// frontend/web-app/src/pages/LoginPage.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { DEMO_MODE, DEMO_CREDENTIALS } from '../config';

const LoginPage = () => {
  const navigate = useNavigate();
  const { signIn, error, clearError } = useAuthStore();

  const [email, setEmail] = useState(DEMO_MODE ? DEMO_CREDENTIALS.email : '');
  const [password, setPassword] = useState(DEMO_MODE ? DEMO_CREDENTIALS.password : '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch {
      /* error surfaced from the store */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <h2 className="auth-title">Welcome back</h2>
        <p>Sign in to book a ride.</p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button className="full" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: 16, marginBottom: 0 }}>
          No account? <Link to="/signup">Create one</Link>
        </p>

        {DEMO_MODE && (
          <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            Demo mode — any email works, password must be 8+ characters.
          </p>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
