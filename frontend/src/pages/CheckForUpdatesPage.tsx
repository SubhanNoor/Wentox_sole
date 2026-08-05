import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { RefreshCw, Download, CheckCircle2, AlertTriangle } from 'lucide-react';

// The ONE page in this whole frontend that calls the real backend (window.api.updates.check()/
// install() — backend/src/services/updates.service.js) instead of AppContext demo data. There's
// no meaningful "demo" version of an internet/update check to fake, so this is genuinely wired
// rather than previewed like every other page.
type UpdateStatus = 'idle' | 'checking' | 'no-internet' | 'error' | 'up-to-date' | 'update-available' | 'downloading' | 'installed';

export default function CheckForUpdatesPage() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [message, setMessage] = useState('');
  const [info, setInfo] = useState<{ currentVersion?: string; latestVersion?: string }>({});

  // Step 1 (internet) and step 2 (the actual update lookup) both happen inside
  // window.api.updates.check() on the backend — see updates.service.js#check() for exactly where
  // "no internet at all" (a real error, code NO_INTERNET) is distinguished from "the connection
  // dropped partway through the lookup" (never surfaced as an error, just reported as no update).
  const handleCheckForUpdates = async () => {
    setStatus('checking');
    setMessage('');

    if (!window.api?.updates) {
      setStatus('error');
      setMessage('Update checking only works inside the desktop app.');
      return;
    }

    const res = await window.api.updates.check();

    if (!res.ok) {
      setStatus(res.error?.code === 'NO_INTERNET' ? 'no-internet' : 'error');
      setMessage(res.error?.message || 'Could not check for updates.');
      return;
    }

    const data = res.data!;
    setInfo({ currentVersion: data.currentVersion, latestVersion: data.latestVersion });
    if (data.updateAvailable) {
      setStatus('update-available');
    } else {
      setStatus('up-to-date');
      setMessage(data.packaged === false ? 'Update checking only works in a packaged build.' : "You're on the latest version.");
    }
  };

  // Only reachable after the user explicitly said yes on the update-available prompt below.
  const handleInstallUpdate = async () => {
    setStatus('downloading');
    setMessage('');
    const res = await window.api!.updates.install();
    if (!res.ok) {
      setStatus('error');
      setMessage(res.error?.message || 'Could not install the update.');
      return;
    }
    setStatus('installed');
    setMessage('Update downloaded — the app will restart to finish installing.');
  };

  const declineUpdate = () => {
    setStatus('idle');
    setMessage('');
  };

  return (
    <AppLayout pageTitle="Check for Updates">
      <div className="mx-auto" style={{ maxWidth: 600 }}>
        <div className="card-white p-6 md:p-8 bg-white border">
          <h3 className="font-lora font-semibold text-lg border-b pb-3 mb-4 text-slate-800 flex items-center gap-2">
            <RefreshCw size={20} className="text-amber-600" /> Check for Updates
          </h3>
          <p className="text-xs text-slate-500 font-medium mb-5">
            Checks your internet connection, then looks for a newer version of WentoX. Nothing
            downloads until you say yes.
          </p>

          {(status === 'no-internet' || status === 'error') && (
            <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" /> {message}
            </div>
          )}
          {(status === 'up-to-date' || status === 'installed') && (
            <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" /> {message}
            </div>
          )}

          {status === 'update-available' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-slate-700 mb-3">
                A new version is available{info.latestVersion ? ` (v${info.latestVersion})` : ''}
                {info.currentVersion ? ` — you're on v${info.currentVersion}` : ''}. Update now?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={declineUpdate}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Not Now
                </button>
                <button
                  onClick={handleInstallUpdate}
                  className="btn-gold flex items-center gap-1 px-4 py-2 text-sm"
                >
                  <Download size={14} /> Update Now
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleCheckForUpdates}
              disabled={status === 'checking' || status === 'downloading'}
              className="btn-gold w-full flex items-center justify-center gap-1 disabled:opacity-60"
            >
              <RefreshCw size={16} className={status === 'checking' ? 'animate-spin' : ''} />
              {status === 'checking'
                ? 'Checking...'
                : status === 'downloading'
                ? 'Downloading & Installing...'
                : 'Check for Updates'}
            </button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
