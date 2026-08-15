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
