import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

/**
 * Transient feedback for a toolbar action, floated into the empty gutter to the RIGHT of the page
 * card instead of pushing the toolbar down.
 *
 * The banners used to render inline above the toolbar, so every "Please select an account." or
 * "Entry added" shoved the whole card down a line and the buttons moved under the cursor mid-click
 * (per the user, 2026-08-31). Out here nothing reflows: the card never moves, whatever the app is
 * telling you.
 *
 * Placement: fixed, just under the header stack and hard right. The content card is capped at
 * 1200px and centred, so on any reasonably wide window this lands in dead space beside it. On a
 * narrow window it overlaps the card's right edge — accepted deliberately, because these messages
 * are short-lived and a message you cannot see is worse than one briefly covering a field.
 */
interface PageToastsProps {
  error?: string;
  success?: string;
  /** Neutral/informational, e.g. "Voucher saved — 2 entries". */
  info?: string;
  onDismissError?: () => void;
  onDismissSuccess?: () => void;
  onDismissInfo?: () => void;
}

function Toast({
  tone, text, onDismiss,
}: { tone: 'error' | 'success' | 'info'; text: string; onDismiss?: () => void }) {
  const cls = tone === 'error' ? 'banner-error' : tone === 'success' ? 'banner-success' : 'banner-info';
  const Icon = tone === 'error' ? AlertTriangle : CheckCircle2;
  return (
    <div
      className={`${cls} rounded-lg shadow-lg px-3 py-2.5 text-sm flex items-start gap-2 animate-in slide-in-from-right-4 fade-in duration-200`}
      role="status"
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1 min-w-0 leading-snug">{text}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          className="shrink-0 -mr-0.5 opacity-60 hover:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default function PageToasts({
  error, success, info, onDismissError, onDismissSuccess, onDismissInfo,
}: PageToastsProps) {
  if (!error && !success && !info) return null;
  return (
    <div
      // data-no-print: this is screen feedback, never part of a printed voucher.
      data-no-print
      className="fixed z-50 flex flex-col gap-2 pointer-events-none"
      style={{
        // Clears the header + nav + quick-menu stack (measured at 144px); the token lets one place
        // follow the header if its height ever changes.
        top: 'calc(var(--app-header-h, 144px) + 0.75rem)',
        right: '1rem',
        width: 'min(22rem, calc(100vw - 2rem))',
      }}
    >
      {/* pointer-events restored per toast, so the gutter itself stays click-through. */}
      <div className="contents [&>*]:pointer-events-auto">
        {error && <Toast tone="error" text={error} onDismiss={onDismissError} />}
        {success && <Toast tone="success" text={success} onDismiss={onDismissSuccess} />}
        {info && <Toast tone="info" text={info} onDismiss={onDismissInfo} />}
      </div>
    </div>
  );
}
