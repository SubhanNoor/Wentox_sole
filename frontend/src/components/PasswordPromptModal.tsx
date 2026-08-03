import React, { useState } from 'react';
import { Lock, Eye, EyeOff, X, KeyRound, ShieldAlert } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface PasswordPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
  subtitle?: string;
}

export default function PasswordPromptModal({
  isOpen,
  onClose,
  onSuccess,
  title = 'Password Authorization Required',
  subtitle
}: PasswordPromptModalProps) {
  const { state } = useApp();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const currentUsername = state.currentUsername || (state.currentUserRole === 'Admin' ? 'admin' : 'user');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Please enter your password.');
      return;
    }

    // Determine correct password for current user or admin
    let isValid = false;

    // Admin password check (admin password always works as master)
    if (password === state.settings.password) {
      isValid = true;
    } 
    // Standard user password check ('user')
    else if (currentUsername === 'user' && password === 'user') {
      isValid = true;
    }
    // Fallback default checks
    else if (password === 'admin' || password === 'user') {
      isValid = true;
    }

    if (isValid) {
      setPassword('');
      setErrorMsg('');
      onSuccess();
    } else {
      setErrorMsg(`Incorrect password for user '${currentUsername}'. Authorization failed.`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
        {/* Header Banner in Wentox Deep Navy */}
        <div className="bg-[#111c2a] p-5 text-white flex items-center justify-between border-b border-[#B08D57]/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#B08D57]/20 border border-[#B08D57]/40 text-[#B08D57]">
              <KeyRound size={22} />
            </div>
            <div>
              <h3 className="font-lora font-bold text-base text-[#B08D57]">{title}</h3>
              <p className="text-xs text-slate-300 font-inter mt-0.5">
                User: <span className="font-bold text-white uppercase tracking-wider">{currentUsername}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPassword('');
              setErrorMsg('');
              onClose();
            }}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <p className="text-xs font-semibold text-slate-600 mb-4 leading-relaxed">
            {subtitle || `Please enter password for user '${currentUsername}' to confirm this action.`}
          </p>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1">
              <Lock size={12} className="text-[#B08D57]" /> User Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="Enter password..."
                className="soleria-input w-full pr-10 py-2.5 text-xs font-semibold"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => {
                setPassword('');
                setErrorMsg('');
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-lg transition-all shadow-sm"
            >
              Authorize &amp; Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
