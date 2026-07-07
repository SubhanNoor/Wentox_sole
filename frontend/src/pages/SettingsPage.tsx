import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Save, Lock, User } from 'lucide-react';

export default function SettingsPage() {
  const { state, dispatch } = useApp();

  const [username, setUsername] = useState(state.settings.username);
  const [password, setPassword] = useState(state.settings.password);
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleUpdateSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setErrorMsg('Username cannot be empty.');
    if (!password.trim()) return setErrorMsg('Password cannot be empty.');
    if (password !== confirmPassword) return setErrorMsg('Passwords do not match.');

    dispatch({
      type: 'UPDATE_SETTINGS',
      settings: { username, password }
    });

    setErrorMsg('');
    setConfirmPassword('');
    setSuccessMsg('Settings updated successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="System Settings">
      <div className="mx-auto" style={{ maxWidth: 600 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        <div className="card-white p-5 bg-white border">
          <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
            <Lock size={18} className="text-amber-600" /> Admin Credentials Configuration
          </h3>
          
          <form onSubmit={handleUpdateSettings} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                <User size={12} /> Administrator Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="soleria-input"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                <Lock size={12} /> New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="soleria-input"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                <Lock size={12} /> Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm password..."
                className="soleria-input"
              />
            </div>
            <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
              <Save size={16} /> Save Admin Settings
            </button>
          </form>
        </div>

      </div>
    </AppLayout>
  );
}
