import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import { AppProvider } from '@/context/AppContext'
import { installApiBridge } from '@/lib/ipcBridge'
import { readStoredZoom } from '@/lib/zoom'
import * as api from '@/lib/api'

// Must run before anything else touches window.api — see lib/ipcBridge.ts.
installApiBridge();

// Re-apply this machine's saved zoom (or the shipped 90% default) immediately after the bridge is
// up and BEFORE the first render. Electron's zoom factor does not survive a restart, so without
// this every launch opens at 100% and only corrects itself once a component mounts — visible as the
// whole window resizing a moment after it appears. Fire-and-forget: a failure here must never stop
// the app from rendering, and the control in the header can still fix it by hand.
api.zoom.set(readStoredZoom()).catch(() => {});

// SB-01: "Save and Post did nothing on one laptop", with no error and nothing in any log.
//
// ErrorBoundary catches errors thrown while RENDERING. It cannot catch an async failure — a rejected
// promise inside a click handler, or a TypeError from reading a property of an undefined
// `window.api.<feature>` (the exact trap backend/CLAUDE.md warns about: a channel added without its
// feature name in ipcBridge.ts's FEATURES array throws instead of returning a failed ApiResult).
// Either of those unwinds the handler silently, so the button genuinely appears to do nothing.
//
// This makes that class of failure impossible to miss: it prints the error and shows it on screen.
// Built with plain DOM rather than React state on purpose — it has to survive a React tree that is
// already in trouble, and it must not depend on any component being mounted. It is a DIAGNOSTIC, not
// a fix: it does not stop anything failing, it stops the failure being invisible.
function reportUnhandled(label: string, detail: unknown) {
  // A rejection is not always an Error. `String({code:'NO_BRIDGE'})` gives "[object Object]", which
  // tells the person reading the banner nothing — and an object is exactly what a rejected ApiResult
  // or an IPC failure looks like. Serialise those instead.
  const describe = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value); // circular / unserialisable
      }
    }
    return String(value);
  };
  const message = describe(detail);
  console.error(`[Wentox] ${label}:`, detail);

  const ID = 'wentox-unhandled-error';
  const existing = document.getElementById(ID);
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.id = ID;
  box.setAttribute('style', [
    'position:fixed', 'bottom:16px', 'left:16px', 'right:16px', 'z-index:99999',
    'background:#fff1f2', 'border:1px solid #fda4af', 'border-radius:10px',
    'padding:12px 14px', 'font:13px/1.5 system-ui,sans-serif', 'color:#881337',
    'box-shadow:0 10px 30px rgba(0,0,0,.18)', 'max-height:40vh', 'overflow:auto',
  ].join(';'));
  box.innerHTML =
    `<div style="font-weight:700;margin-bottom:4px">Something failed without reporting itself (${label})</div>` +
    `<div style="font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-word"></div>` +
    `<div style="margin-top:8px;font-size:12px;color:#9f1239">` +
    `Please screenshot this and send it over — it names what went wrong.</div>`;
  // textContent, not innerHTML, for the message itself: an error string can contain anything.
  (box.children[1] as HTMLElement).textContent = message;

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Dismiss';
  dismiss.setAttribute('style', 'margin-top:8px;font-size:12px;font-weight:700;color:#881337;text-decoration:underline;background:none;border:none;cursor:pointer;padding:0');
  dismiss.onclick = () => box.remove();
  box.appendChild(dismiss);

  document.body.appendChild(box);
}

window.addEventListener('unhandledrejection', e => reportUnhandled('unhandled promise rejection', e.reason));
window.addEventListener('error', e => reportUnhandled('uncaught error', e.error ?? e.message));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AppProvider>
          <App />
        </AppProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
