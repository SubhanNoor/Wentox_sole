import { useState, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import * as api from '@/lib/api';
import type { UserAccountRow } from '@/lib/api';
import { UserPlus, Lock, User, ShieldCheck, UsersRound, UserX, UserCheck, KeyRound, X, Save } from 'lucide-react';
import DataListTable from '@/components/DataListTable';

export default function UserManagementPage() {
  const { state } = useApp();
  const [users, setUsers] = useState<UserAccountRow[]>([]);

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset-password modal state
  const [resetTarget, setResetTarget] = useState<UserAccountRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);

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

  const handleToggleActive = async (u: UserAccountRow) => {
    setErrorMsg('');
    const verb = u.is_active ? 'deactivate' : 'reactivate';
    if (!window.confirm(`Are you sure you want to ${verb} "${u.username}"?`)) return;
    const res = await api.setUserActive(u.user_id, !u.is_active);
    if (!res.ok) {
      setErrorMsg(res.error.message);
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }
    setSuccessMsg(`User "${u.username}" ${u.is_active ? 'deactivated' : 'reactivated'} successfully.`);
    setTimeout(() => setSuccessMsg(''), 3000);
    await loadUsers();
  };

  const openResetPassword = (u: UserAccountRow) => {
    setResetTarget(u);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetError('');
  };

  const closeResetPassword = () => {
    setResetTarget(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetError('');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError('');
    if (!newPassword) return setResetError('New password is required.');
    if (newPassword !== confirmNewPassword) return setResetError('Passwords do not match.');

    setResetting(true);
    const res = await api.resetUserPassword(resetTarget.user_id, newPassword);
    setResetting(false);

    if (!res.ok) {
      setResetError(res.error.message);
      return;
    }

    setSuccessMsg(`Password reset for "${resetTarget.username}".`);
    setTimeout(() => setSuccessMsg(''), 3000);
    closeResetPassword();
  };

  return (
    <AppLayout pageTitle="Manage Users">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}

        {/* Toolbar — Create User lives in its own dedicated bar above the card, same shape as the
            Receipts/Expenses/Sale Bill toolbars, instead of at the bottom of the form. */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-4 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
          <button
            type="submit"
            form="create-user-form"
            disabled={submitting}
            className="btn-gold flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg"
          >
            <UserPlus size={16} /> {submitting ? 'Creating User…' : 'Create User'}
          </button>
          <span className="text-sm font-semibold text-slate-700">{users.length} account(s)</span>
        </div>

        <div className="card-white p-6 md:p-8 bg-white border mb-6">
          <div className="border-b pb-4 mb-6">
            <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
              <UserPlus size={20} className="text-[#B08D57]" /> Create Limited-Access User
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              New accounts are always created with limited access — Cash at Banks and Directors
              Drawings stay hidden from them.
            </p>
          </div>

          <form id="create-user-form" onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div className="flex flex-col gap-4">
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
            </div>

            <div className="flex flex-col gap-4">
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
          </form>
        </div>

        <div className="card-white p-6 md:p-8 bg-white border">
          <div className="border-b pb-4 mb-5">
            <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
              <UsersRound size={20} className="text-[#B08D57]" /> Existing Accounts
            </h3>
          </div>

          <DataListTable<UserAccountRow>
            rows={users}
            rowKey={u => u.user_id}
            emptyMessage="No user accounts found."
            columns={[
              {
                key: 'username',
                header: 'Username',
                render: u => (
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    {u.role === 'Admin' && <ShieldCheck size={13} className="text-[#B08D57]" />}
                    {u.username}
                    {u.username === state.currentUsername && (
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">(You)</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'full_name',
                header: 'Full Name',
                render: u => (
                  <span className="text-slate-500 font-medium text-xs">{u.full_name || '—'}</span>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                width: '110px',
                align: 'center',
                render: u => (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    u.role === 'Admin'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    {u.role}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                align: 'center',
                render: u => (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                    u.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
            ]}
            actions={u => {
              const isSelf = u.username === state.currentUsername;
              return (
                <>
                  <button
                    onClick={() => openResetPassword(u)}
                    title="Reset Password"
                    className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                  >
                    <KeyRound size={15} />
                  </button>
                  <button
                    onClick={() => handleToggleActive(u)}
                    disabled={isSelf}
                    title={isSelf ? 'You cannot deactivate your own account' : u.is_active ? 'Deactivate' : 'Reactivate'}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                      u.is_active ? 'hover:bg-rose-50 text-slate-400 hover:text-rose-600' : 'hover:bg-emerald-50 text-slate-400 hover:text-emerald-600'
                    }`}
                  >
                    {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                  </button>
                </>
              );
            }}
          />
        </div>

        {resetTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={closeResetPassword}
            onKeyDown={e => { if (e.key === 'Escape') { (closeResetPassword)(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-[var(--brand-gold)] shadow-[0_20px_50px_rgba(176,141,87,0.28)] w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-lora font-bold text-lg text-slate-900 flex items-center gap-2">
                  <KeyRound size={18} className="text-[#B08D57]" /> Reset Password
                </h3>
                <button onClick={closeResetPassword} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleResetPassword} className="p-5 flex flex-col gap-4">
                <p className="text-xs text-slate-500 -mt-1">
                  Setting a new password for <span className="font-bold text-slate-700">{resetTarget.username}</span>.
                </p>

                {resetError && (
                  <div className="banner-error rounded-lg px-3 py-2 text-xs">{resetError}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    New Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="soleria-input w-full font-semibold"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Confirm New Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={e => setConfirmNewPassword(e.target.value)}
                    className="soleria-input w-full font-semibold"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button type="button" onClick={closeResetPassword} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">
                    Cancel
                  </button>
                  <button type="submit" disabled={resetting} className="btn-gold px-5 py-2 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                    <Save size={14} /> {resetting ? 'Saving…' : 'Save Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
