import * as api from '@/lib/api';
import { isChildWindow, shouldAutoPreview } from '@/lib/windowParams';

// A report's "Show Print Preview" opens a window that goes straight into the preview. That window
// exists only for the preview, so closing the preview closes the window too, and focus returns to
// the window that opened it (windowManager.js#closeChildAndFocusMain). First done on Vendor Report,
// made the rule for every report per the user, 2026-10-14. Fixed for a window's lifetime: this app
// has no client-side routing.
export const IS_PREVIEW_WINDOW = isChildWindow() && shouldAutoPreview();

export function closePreviewWindow() {
  if (IS_PREVIEW_WINDOW) api.closeThisWindow();
}
