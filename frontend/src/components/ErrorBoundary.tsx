import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * CH-02: "cheque ledger detailed view is not showing on one laptop" turned out to have no
 * reproducible code bug in the cheque ledger itself, but this app had NO error boundary anywhere
 * — any uncaught render-time exception (a null field in an edge-case row that only exists in one
 * machine's data, say) produces a blank white screen with zero feedback, which matches "just not
 * showing" exactly. This is the general fix: catch it, show what broke instead of nothing, and
 * offer a way back rather than a dead window.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-screen p-6" style={{ background: 'var(--app-bg)' }}>
          <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 shadow-xl p-8 text-center">
            <div className="mx-auto mb-4 flex items-center justify-center w-14 h-14 rounded-full bg-rose-50">
              <AlertTriangle size={28} className="text-rose-600" />
            </div>
            <h1 className="font-lora font-bold text-lg text-slate-900 mb-2">Something went wrong on this page</h1>
            <p className="text-sm text-slate-500 mb-4">
              The screen hit an unexpected error and couldn't display. Reloading usually fixes it —
              if it keeps happening, note the message below and report it.
            </p>
            <div className="text-left text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 mb-6 text-rose-700 break-words">
              {this.state.error.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-gold px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2"
            >
              <RotateCcw size={16} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
