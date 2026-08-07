import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import * as api from '@/lib/api';
import type { UserAccountRow } from '@/lib/api';
import { UserPlus, Lock, User, ShieldCheck, UsersRound } from 'lucide-react';

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserAccountRow[]>([]);

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await api.listUsers();
    if (res.ok) setUsers(res.data);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!username.trim()) return setErrorMsg('Username is required.');
    if (!password) return setErrorMsg('Password is required.');
    if (password !== confirmPassword) return setErrorMsg('Passwords do not match.');

    setSubmitting(true);
    const result = await api.createUser({
      username: username.trim(),
      password,
      fullName: fullName.trim() || undefined
    });
    setSubmitting(false);

    if (!result.ok) {
      setErrorMsg(result.error.message);
      return;
    }

    setUsername('');
    setFullName('');
    setPassword('');
    setConfirmPassword('');
    setSuccessMsg(`User "${result.data.username}" created successfully.`);
    setTimeout(() => setSuccessMsg(''), 3000);
    await loadUsers();
  };

  return (
    <AppLayout pageTitle="Manage Users">
      <div className="mx-auto" style={{ maxWidth: 900 }}>

        <div className="card-white p-6 md:p-8 bg-white border max-w-xl mx-auto mb-6">
          <div className="border-b pb-4 mb-6">
            <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
              <UserPlus size={20} className="text-[#B08D57]" /> Create Limited-Access User
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              New accounts are always created with limited access — Cash at Banks and Directors
              Drawings stay hidden from them.
            </p>
          </div>

          {successMsg && (
            <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
          )}
          {errorMsg && (
            <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
          )}

          <form onSubmit={handleCreateUser} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                <User size={12} className="text-slate-400" /> Username <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. worker1"
                className="soleria-input w-full font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                <User size={12} className="text-slate-400" /> Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Optional"
                className="soleria-input w-full font-semibold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                  <Lock size={12} className="text-slate-400" /> Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="soleria-input w-full font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                  <Lock size={12} className="text-slate-400" /> Confirm Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="soleria-input w-full font-semibold"
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-gold w-full mt-3 py-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer shadow-2xs hover:shadow-xs"
              disabled={submitting}
            >
              <UserPlus size={15} /> {submitting ? 'Creating User…' : 'Create User'}
            </button>
          </form>
        </div>

        <div className="card-white p-6 md:p-8 bg-white border max-w-xl mx-auto">
          <div className="border-b pb-4 mb-5">
            <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
              <UsersRound size={20} className="text-[#B08D57]" /> Existing Accounts
            </h3>
          </div>

          <div className="flex flex-col gap-2">
            {users.map(u => (
              <div
                key={u.user_id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/80"
              >
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    {u.role === 'Admin' && <ShieldCheck size={13} className="text-[#B08D57]" />}
                    {u.username}
                  </div>
                  {u.full_name && (
                    <div className="text-[11px] text-slate-500 font-medium">{u.full_name}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    u.role === 'Admin'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    {u.role}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    u.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
