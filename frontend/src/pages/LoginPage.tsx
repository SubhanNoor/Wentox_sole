import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import * as api from '@/lib/api';

export default function LoginPage() {
  const { dispatch } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password.');
      return;
    }
    setSubmitting(true);
    const result = await api.login(username.trim(), password);
    setSubmitting(false);
    if (result.ok) {
      dispatch({ type: 'LOGIN_SUCCESS', payload: result.data });
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div
      className="flex items-center justify-center min-h-screen login-page-outer"
      style={{ background: 'var(--app-bg)' }}
    >
      <div
        className="flex w-full overflow-hidden login-card"
        style={{
          maxWidth: 960,
          minHeight: 480,
          borderRadius: 14,
          boxShadow: '0 30px 70px rgba(27,42,65,0.14)',
        }}
      >
        {/* Left branded panel */}
        <div
          className="relative flex flex-col justify-between overflow-hidden login-brand-panel"
          style={{
            flex: '0 0 50%',
            background: 'var(--brand-navy)',
            padding: 44,
            minHeight: 480,
          }}
        >
          {/* Content overlay */}
          <div className="relative" style={{ zIndex: 2 }}>
            <div
              className="flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: 9,
                background: 'var(--brand-gold)',
              }}
            >
              <span className="font-lora font-bold text-xl" style={{ color: 'var(--brand-navy)' }}>W</span>
            </div>
          </div>

          <div className="relative login-brand-copy" style={{ zIndex: 2 }}>
            <h2
              className="font-lora font-semibold"
              style={{ fontSize: '30px', color: '#ffffff', lineHeight: 1.22 }}
            >
              Wentox<br />Warehouse
            </h2>
            <div
              className="mt-4 rounded-full"
              style={{ width: 46, height: 2, background: 'var(--brand-gold)' }}
            />
            <p
              className="mt-4 font-inter"
              style={{ color: 'rgba(250,248,243,0.6)', fontSize: '14px', lineHeight: 1.6 }}
            >
              Footwear manufacturing &amp; wholesale distribution ERP. A clean, simple, and unified control center for Lahore operations.
            </p>
          </div>

          {/* Decorative rings */}
          <div
            className="absolute rounded-full"
            style={{
              width: 330, height: 330,
              right: -90, top: -70,
              border: '1px solid rgba(176,141,87,0.32)',
              zIndex: 0,
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 230, height: 230,
              right: -40, top: -20,
              border: '1px solid rgba(176,141,87,0.24)',
              zIndex: 0,
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 128, height: 128,
              right: 12, top: 34,
              border: '1px solid rgba(176,141,87,0.16)',
              zIndex: 0,
            }}
          />
        </div>

        {/* Right panel - form */}
        <div
          className="flex flex-col justify-center login-form-panel"
          style={{
            flex: '0 0 50%',
            background: '#ffffff',
            padding: '48px 44px',
          }}
        >
          <h3
            className="font-lora font-semibold"
            style={{ fontSize: '23px', color: 'var(--dark-heading)' }}
          >
            Welcome back
          </h3>
          <p className="mt-1 font-inter" style={{ color: 'var(--secondary-text)', fontSize: '14px' }}>
            Sign in to access your business khata, sales, and stocks.
          </p>

          <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
            <div>
              <label
                className="block font-inter font-semibold mb-1.5"
                style={{ fontSize: '12px', color: 'var(--dark-heading)' }}
              >
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
                className="soleria-input w-full"
              />
            </div>
            <div>
              <label
                className="block font-inter font-semibold mb-1.5"
                style={{ fontSize: '12px', color: 'var(--dark-heading)' }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                className="soleria-input w-full"
              />
            </div>
            {error && (
              <div className="banner-error rounded-lg px-3 py-2 text-sm">{error}</div>
            )}
            <button type="submit" className="btn-gold w-full mt-1" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Log In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
