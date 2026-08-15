import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import * as api from '@/lib/api';
import { Save, Lock, User, RefreshCw, Download, CheckCircle2, AlertTriangle, ShieldCheck, Cpu, Sparkles, Server, DatabaseBackup, HardDrive, FolderOpen } from 'lucide-react';

type SettingsTab = 'credentials' | 'backup' | 'updates';
type UpdateStatus = 'idle' | 'checking' | 'no-internet' | 'error' | 'up-to-date' | 'update-available' | 'downloading' | 'installed';

export default function SettingsPage() {
  const { state, dispatch } = useApp();
  const isAdmin = state.currentUserRole === 'Admin';

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (state.currentTab === 'backup' || state.currentTab === 'updates') return state.currentTab;
    return isAdmin ? 'credentials' : 'updates';
  });

  useEffect(() => {
    if (state.currentTab === 'credentials' || state.currentTab === 'backup' || state.currentTab === 'updates') {
      setActiveTab(state.currentTab);
    }
  }, [state.currentTab]);

  // Credentials State
  const [currentPassword, setCurrentPassword] = useState('');
  const [username, setUsername] = useState(state.currentUsername || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credSuccessMsg, setCredSuccessMsg] = useState('');
  const [credErrorMsg, setCredErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Updates State
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateInfo, setUpdateInfo] = useState<{ currentVersion?: string; latestVersion?: string }>({
    currentVersion: '1.0.4',
    latestVersion: '1.0.4'
  });

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredErrorMsg('');
    if (!currentPassword.trim()) return setCredErrorMsg('Enter your current password to confirm this change.');
    if (!username.trim()) return setCredErrorMsg('Username cannot be empty.');
    if (password && password !== confirmPassword) return setCredErrorMsg('Passwords do not match.');

    const usernameChanged = username.trim() !== state.currentUsername;
    if (!usernameChanged && !password) {
      return setCredErrorMsg('Change the username or enter a new password — nothing to update otherwise.');
    }

    setSubmitting(true);
    const result = await api.updateCredentials({
      currentPassword,
      username: usernameChanged ? username.trim() : undefined,
      newPassword: password || undefined
    });
    setSubmitting(false);

    if (!result.ok) {
      setCredErrorMsg(result.error.message);
      return;
    }

    if (usernameChanged) {
      dispatch({ type: 'RENAME_CURRENT_USER', username: result.data.username });
    }

    setCurrentPassword('');
    setPassword('');
    setConfirmPassword('');
    setCredSuccessMsg('Admin credentials updated successfully.');
    setTimeout(() => setCredSuccessMsg(''), 3000);
  };

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateMessage('');

    if (!window.api?.updates) {
      // Preview mode in browser
      setTimeout(() => {
        setUpdateStatus('up-to-date');
        setUpdateMessage("You're on the latest release of WentoX (v1.0.4).");
      }, 1000);
      return;
    }

    const res = await window.api.updates.check();

    if (!res.ok) {
      setUpdateStatus(res.error?.code === 'NO_INTERNET' ? 'no-internet' : 'error');
      setUpdateMessage(res.error?.message || 'Could not check for updates.');
      return;
    }

    const data = res.data!;
    setUpdateInfo({ currentVersion: data.currentVersion || '1.0.4', latestVersion: data.latestVersion || '1.0.4' });
    if (data.updateAvailable) {
      setUpdateStatus('update-available');
    } else if (data.checkError) {
      // Don't claim "you're up to date" when the lookup itself failed — that made a permanent
      // fault (private repo, draft release, missing latest.yml) look identical to genuinely
      // having the newest build.
      setUpdateStatus('error');
      setUpdateMessage(`Could not reach the update server: ${data.checkError}`);
    } else {
      setUpdateStatus('up-to-date');
      setUpdateMessage(data.packaged === false ? 'Update checking is enabled for packaged desktop releases.' : "You are running the latest version of WentoX.");
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateStatus('downloading');
    setUpdateMessage('');
    if (!window.api?.updates) return;
    const res = await window.api.updates.install();
    if (!res.ok) {
      setUpdateStatus('error');
      setUpdateMessage(res.error?.message || 'Could not install the update.');
      return;
    }
    setUpdateStatus('installed');
    setUpdateMessage('Update downloaded — WentoX will restart automatically to finish installing.');
  };

  const declineUpdate = () => {
    setUpdateStatus('idle');
    setUpdateMessage('');
  };

  // Backup DB State — syncs the live backup database (via native SQL Server BACKUP/RESTORE, see
  // backend/src/services/backup.service.js) on top of the periodic 10-minute auto-sync; lets the
  // shop PC user force it when they need certainty (e.g. right before closing for the day).
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupError, setBackupError] = useState('');
  const [backupLastSync, setBackupLastSync] = useState<string | null>(null);

  const handleBackupNow = async () => {
    setBackupRunning(true);
    setBackupMessage('');
    setBackupError('');

    if (!window.api?.backup) {
      setTimeout(() => {
        setBackupRunning(false);
        setBackupMessage('Preview mode — backup runs only in the desktop app.');
      }, 800);
      return;
    }

    const res = await window.api.backup.runNow();
    setBackupRunning(false);
    if (!res.ok) {
      setBackupError(res.error?.message || 'Could not update the backup.');
      return;
    }
    const statusRes = await window.api.backup.status();
    if (statusRes.ok && statusRes.data?.lastSyncAt) {
      setBackupLastSync(new Date(statusRes.data.lastSyncAt).toLocaleString());
    }
    setBackupMessage('Backup updated — it now matches the live database.');
  };

  // External-drive backup state. Separate from the mirror above in every way that matters: it's a
  // single .bak file on a drive that comes and goes, written only when someone asks for it.
  const [externalFolder, setExternalFolder] = useState<string | null>(null);
  const [externalConnected, setExternalConnected] = useState(false);
  const [externalLastAt, setExternalLastAt] = useState<string | null>(null);
  const [externalSize, setExternalSize] = useState<number | null>(null);
  const [externalRunning, setExternalRunning] = useState(false);
  const [externalMessage, setExternalMessage] = useState('');
  const [externalError, setExternalError] = useState('');

  // Reads the saved folder and whether the drive is plugged in right now, so the card can say so
  // before anything is pressed rather than only as the outcome of a failed attempt. Called when the
  // Backup tab is opened and after every action — not from an effect, since the tab is only ever
  // reached by clicking it (admins land on Credentials, non-admins never see this tab at all).
  const refreshBackupStatus = async () => {
    if (!window.api?.backup) return;
    const res = await window.api.backup.status();
    if (!res.ok || !res.data) return;
    setBackupLastSync(res.data.lastSyncAt ? new Date(res.data.lastSyncAt).toLocaleString() : null);
    setExternalFolder(res.data.externalFolder);
    setExternalConnected(res.data.externalDriveConnected);
    setExternalLastAt(res.data.lastExternalAt ? new Date(res.data.lastExternalAt).toLocaleString() : null);
    setExternalSize(res.data.lastExternalSizeBytes);
  };

  const handleChooseExternalFolder = async () => {
    setExternalMessage('');
    setExternalError('');
    if (!window.api?.backup) {
      setExternalMessage('Preview mode — choosing a folder works only in the desktop app.');
      return;
    }
    const res = await window.api.backup.chooseExternalFolder();
    if (!res.ok) {
      setExternalError(res.error?.message || 'Could not open the folder picker.');
      return;
    }
    if (res.data?.canceled) return;
    await refreshBackupStatus();
    setExternalMessage(`Backup folder set to ${res.data?.folder}.`);
  };

  const handleBackupToExternal = async () => {
    setExternalRunning(true);
    setExternalMessage('');
    setExternalError('');

    if (!window.api?.backup) {
      setTimeout(() => {
        setExternalRunning(false);
        setExternalMessage('Preview mode — backup runs only in the desktop app.');
      }, 800);
      return;
    }

    const res = await window.api.backup.runExternal();
    setExternalRunning(false);
    await refreshBackupStatus();
    if (!res.ok) {
      // backup.service.js turns every known failure into a readable ApiError, so this message is
      // the real reason (drive unplugged, folder blocked, disk full) rather than "Internal error".
      setExternalError(res.error?.message || 'Could not back up to the external drive.');
      return;
    }
    setExternalMessage('Backup written to the external drive and verified. It is safe to unplug.');
  };

  const formatSize = (bytes: number | null) =>
    bytes == null ? '' : `${(bytes / 1024 / 1024).toFixed(0)} MB`;

  return (
    <AppLayout pageTitle="Settings" subTabTitle={activeTab === 'backup' ? 'Backup' : activeTab === 'updates' ? 'Updates' : 'Credentials'} subTabId={activeTab}>
      <div className="mx-auto" style={{ maxWidth: 900 }}>

        {/* Subpage Pill-Tabs — non-admins only ever get Check for Updates, no credentials tab at all */}
        {isAdmin && (
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1 mb-6 self-start max-w-md">
            <button
              type="button"
              onClick={() => setActiveTab('credentials')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'credentials' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Lock size={14} /> Profile & Credentials
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('backup'); void refreshBackupStatus(); }}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'backup' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <DatabaseBackup size={14} /> Backup
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('updates')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === 'updates' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <RefreshCw size={14} /> Check for Updates
            </button>
          </div>
        )}

        {/* SUBPAGE 1: Profile & Credentials — admin-only */}
        {isAdmin && activeTab === 'credentials' && (
          <div className="animate-in fade-in duration-200">
            <div className="card-white p-6 md:p-8 bg-white border max-w-xl mx-auto">
              <div className="border-b pb-4 mb-6">
                <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                  <ShieldCheck size={20} className="text-[#B08D57]" /> Admin Credentials Configuration
                </h3>
                <p className="text-xs text-slate-500 font-medium">Update your administrator username and secret access password.</p>
              </div>

              {credSuccessMsg && (
                <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{credSuccessMsg}</div>
              )}
              {credErrorMsg && (
                <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{credErrorMsg}</div>
              )}

              <form onSubmit={handleUpdateCredentials} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                    <Lock size={12} className="text-slate-400" /> Current Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="Required to confirm any changes"
                    className="soleria-input w-full font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                    <User size={12} className="text-slate-400" /> Administrator Username <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="soleria-input w-full font-semibold"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                      <Lock size={12} className="text-slate-400" /> New Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Leave blank to keep unchanged"
                      className="soleria-input w-full font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                      <Lock size={12} className="text-slate-400" /> Confirm New Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password..."
                      className="soleria-input w-full font-semibold"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-gold w-full mt-3 py-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer shadow-2xs hover:shadow-xs"
                  disabled={submitting}
                >
                  <Save size={15} /> {submitting ? 'Saving Credentials…' : 'Save Admin Settings'}
                </button>
              </form>
            </div>

          </div>
        )}

        {/* SUBPAGE 2: Backup — admin-only. Was previously a card buried at the bottom of the
            Profile & Credentials tab, which made it effectively undiscoverable; it's a top-level
            tab of its own now. */}
        {isAdmin && activeTab === 'backup' && (
          <div className="animate-in fade-in duration-200">
            <div className="card-white p-6 md:p-8 bg-white border max-w-xl mx-auto">
              <div className="border-b pb-4 mb-6">
                <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                  <DatabaseBackup size={20} className="text-[#B08D57]" /> Backup Database
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Wentox keeps a second copy of the database in your chosen backup folder. It updates
                  automatically every 10 minutes whenever there's new data — press Update Backup Now to
                  bring it fully up to date immediately.
                </p>
              </div>

              {backupMessage && (
                <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{backupMessage}</div>
              )}
              {backupError && (
                <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{backupError}</div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-600 font-medium">
                  Last backup update: <span className="font-semibold text-slate-800">{backupLastSync || 'Not yet run'}</span>
                </div>
                <button
                  type="button"
                  onClick={handleBackupNow}
                  disabled={backupRunning}
                  className="btn-gold flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold disabled:opacity-60 cursor-pointer w-full sm:w-auto"
                >
                  <DatabaseBackup size={15} className={backupRunning ? 'animate-pulse' : ''} />
                  {backupRunning ? 'Updating Backup…' : 'Update Backup Now'}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 font-medium mt-5 leading-relaxed">
                Every update copies the database in full, so the backup always ends up an exact match of
                the live one — including every new row, edit and deletion since the last update.
              </p>
            </div>

            {/* External drive — the only copy that survives this PC. Deliberately manual: the drive
                isn't expected to be plugged in most of the time, so nothing here runs on a timer. */}
            <div className="card-white p-6 md:p-8 bg-white border max-w-xl mx-auto mt-6">
              <div className="border-b pb-4 mb-6">
                <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                  <HardDrive size={20} className="text-[#B08D57]" /> Backup to External Drive
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Writes a complete copy of the database to a USB or external hard drive, so there's a
                  copy that survives even if this computer is lost or its disk fails. Plug the drive in,
                  then press the button — it replaces the previous backup on the drive each time.
                </p>
              </div>

              {externalMessage && (
                <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{externalMessage}</div>
              )}
              {externalError && (
                <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{externalError}</div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 mb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-bold mb-1">
                      Backup folder
                    </div>
                    <div className="text-xs font-mono text-slate-700 break-all">
                      {externalFolder || 'Not set — choose a folder on your external drive'}
                    </div>
                    {externalFolder && (
                      <div className={`text-[11px] font-semibold mt-1.5 flex items-center gap-1.5 ${externalConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${externalConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        {externalConnected ? 'Drive connected' : 'Drive not connected'}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleChooseExternalFolder}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <FolderOpen size={14} /> {externalFolder ? 'Change' : 'Choose'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-600 font-medium">
                  Last backup to drive:{' '}
                  <span className="font-semibold text-slate-800">
                    {externalLastAt || 'Not yet run'}
                    {externalLastAt && externalSize ? ` (${formatSize(externalSize)})` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleBackupToExternal}
                  disabled={externalRunning || !externalFolder}
                  title={!externalFolder ? 'Choose a backup folder first' : undefined}
                  className="btn-gold flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold disabled:opacity-60 cursor-pointer w-full sm:w-auto"
                >
                  <HardDrive size={15} className={externalRunning ? 'animate-pulse' : ''} />
                  {externalRunning ? 'Backing Up…' : 'Back Up to Drive Now'}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 font-medium mt-5 leading-relaxed">
                The backup is checked after writing to confirm the drive holds a complete, readable copy.
                A file called RESTORE-INSTRUCTIONS.txt is saved next to it explaining how to restore the
                database from it. Note this drive holds one copy only — the newest — so it protects
                against losing the computer, not against a mistake made earlier and noticed later.
              </p>
            </div>
          </div>
        )}

        {/* SUBPAGE 3: Check for Updates */}
        {activeTab === 'updates' && (
          <div className="animate-in fade-in duration-200 flex flex-col gap-6">
            
            {/* Version & Status Banner */}
            <div className="card-white p-6 md:p-8 bg-white border">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 mb-6">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                    <RefreshCw size={20} className="text-[#B08D57]" /> Software Updates & System Version
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Verify software integrity, check for online updates, and manage app version releases.</p>
                </div>

                <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-mono font-bold text-slate-700">v{updateInfo.currentVersion || '1.0.4'} (Stable)</span>
                </div>
              </div>

              {/* Status Alert Banners */}
              {(updateStatus === 'no-internet' || updateStatus === 'error') && (
                <div className="banner-error rounded-xl px-4 py-3 text-xs mb-5 flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0" /> {updateMessage}
                </div>
              )}
              {(updateStatus === 'up-to-date' || updateStatus === 'installed') && (
                <div className="banner-success rounded-xl px-4 py-3 text-xs mb-5 flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" /> {updateMessage}
                </div>
              )}

              {updateStatus === 'update-available' ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-5 mb-5">
                  <h4 className="font-bold text-sm text-amber-900 mb-1">New Update Available!</h4>
                  <p className="text-xs text-amber-800 mb-4">
                    A newer release (v{updateInfo.latestVersion}) is ready to download. Your current build is v{updateInfo.currentVersion}.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={declineUpdate}
                      className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer"
                    >
                      Not Now
                    </button>
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      className="btn-gold flex items-center gap-1.5 px-5 py-2 text-xs font-semibold cursor-pointer"
                    >
                      <Download size={14} /> Update Now
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200/80 mb-6">
                  <div className="text-xs text-slate-600 font-medium">
                    Last update check: <span className="font-semibold text-slate-800">Today</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCheckForUpdates}
                    disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                    className="btn-gold flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold disabled:opacity-60 cursor-pointer w-full sm:w-auto"
                  >
                    <RefreshCw size={15} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
                    {updateStatus === 'checking'
                      ? 'Checking Online Server...'
                      : updateStatus === 'downloading'
                      ? 'Downloading Update...'
                      : 'Check for Updates'}
                  </button>
                </div>
              )}

              {/* Rich System Status Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 flex items-start gap-3">
                  <div className="p-2 bg-amber-50 rounded-lg text-[var(--brand-gold)] border border-amber-200/60">
                    <Cpu size={18} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 mb-0.5">Desktop Engine</h5>
                    <p className="text-[11px] text-slate-500 font-medium">High-speed SQLite native database bridge</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 flex items-start gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg text-blue-600 border border-blue-200/60">
                    <Server size={18} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 mb-0.5">Auto Backup</h5>
                    <p className="text-[11px] text-slate-500 font-medium">Syncs automatically every 10 minutes when there's new data</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 flex items-start gap-3">
                  <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600 border border-emerald-200/60">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 mb-0.5">UI Design System</h5>
                    <p className="text-[11px] text-slate-500 font-medium">Gold & Navy Soleria guidelines standard v2.4</p>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </AppLayout>
  );
}
