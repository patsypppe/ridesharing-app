// frontend/web-app/src/pages/SignUpPage.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { DEMO_MODE } from '../config';

const SignUpPage = () => {
  const navigate = useNavigate();
  const { signUp, confirmSignUp, signIn, error, clearError } = useAuthStore();

  const [stage, setStage] = useState('form'); // form | confirm
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [code, setCode] = useState(DEMO_MODE ? '123456' : '');
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSignUp = async (e) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await signUp(form.email, form.password, {
        given_name: form.firstName,
        family_name: form.lastName,
      });
      setStage('confirm');
    } catch {
      /* handled in store */
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await confirmSignUp(form.email, code);
      await signIn(form.email, form.password);
      navigate('/dashboard');
    } catch {
      /* handled in store */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        {stage === 'form' ? (
          <>
            <h2 className="auth-title">Create your account</h2>
            <p>Cognito handles signup, verification and password policy.</p>

            {error && <div className="error-box">{error}</div>}

            <form onSubmit={handleSignUp}>
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="firstName">First name</label>
                  <input id="firstName" value={form.firstName} onChange={set('firstName')} required />
                </div>
                <div className="field">
                  <label htmlFor="lastName">Last name</label>
                  <input id="lastName" value={form.lastName} onChange={set('lastName')} required />
                </div>
              </div>

              <div className="field">
                <label htmlFor="su-email">Email</label>
                <input id="su-email" type="email" value={form.email} onChange={set('email')} required />
              </div>

              <div className="field">
                <label htmlFor="su-password">Password</label>
                <input
                  id="su-password"
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  minLength={8}
                  required
                />
                <p className="hint" style={{ marginTop: 6 }}>
                  8+ chars with upper, lower, number and symbol — enforced by the Cognito user pool.
                </p>
              </div>

              <button className="full" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create account'}
              </button>
            </form>

            <p style={{ marginTop: 16, marginBottom: 0 }}>
              Already registered? <Link to="/login">Sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h2 className="auth-title">Verify your email</h2>
            <p>We sent a confirmation code to {form.email}.</p>

            {error && <div className="error-box">{error}</div>}

            <form onSubmit={handleConfirm}>
              <div className="field">
                <label htmlFor="code">Confirmation code</label>
                <input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <button className="full" type="submit" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify and continue'}
              </button>
            </form>

            {DEMO_MODE && (
              <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
                Demo mode — any code is accepted.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SignUpPage;
