// Minimal ambient type for window.api, exposed by backend/electron/preload.js's contextBridge.
// Only the "updates" feature is typed here (the first page in this frontend to call it for
// real) — every other feature still runs on AppContext demo data, so there's nothing yet to gain
// from typing window.api's full surface ahead of Milestone 9.2's actual wiring pass.
export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: { message: string; code: string };
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
  packaged?: boolean;
}

export interface BackupStatusResult {
  lastSyncAt: string | null;
  lastSyncError: string | null;
  configured: boolean;
}

declare global {
  interface Window {
    api?: {
      updates: {
        check: () => Promise<IpcResult<UpdateCheckResult>>;
        install: () => Promise<IpcResult<{ ok: true }>>;
      };
      backup: {
        // backup.ipc.js's runNow resolves service.sync(), which has no explicit return value —
        // wrap.js yields { ok: true, data: undefined } on success, not a real payload.
        runNow: () => Promise<IpcResult<undefined>>;
        status: () => Promise<IpcResult<BackupStatusResult>>;
      };
      [feature: string]: unknown;
    };
  }
}

export {};
