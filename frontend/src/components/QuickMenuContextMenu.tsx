import { PencilLine, Trash2 } from 'lucide-react';

// The Quick Menu's right-click menu (per the user, 2026-11-26), styled like the MenuBar dropdowns.
// Drawn inside the MenuBar dropdown's own always-on-top window (MenuPopupApp.tsx) so it shows above
// every open screen; AppLayout.tsx draws the same component in-page outside Electron.
export type QuickMenuContextAction = 'rename' | 'drop';

interface Props {
  title: string;
  onPick: (action: QuickMenuContextAction) => void;
}

export default function QuickMenuContextMenu({ title, onPick }: Props) {
  const itemClass =
    'group flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-semibold transition-colors cursor-pointer text-[var(--dark-heading)] hover:bg-[var(--brand-navy-hover)] hover:text-[var(--brand-gold)]';
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ minWidth: 210, background: '#fdfbf4', border: '1px solid rgba(176,141,87,0.55)' }}
    >
      <div
        className="px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider truncate"
        style={{ background: 'var(--brand-navy)', color: 'var(--brand-gold)', maxWidth: 280 }}
      >
        {title}
      </div>
      <div className="py-1">
        <button type="button" className={itemClass} onClick={() => onPick('rename')}>
          <PencilLine size={14} className="text-sky-600 group-hover:text-[var(--brand-gold)]" />
          <span>1. Change Name</span>
        </button>
        <div className="my-1" style={{ borderTop: '1px solid rgba(17,28,42,0.14)' }} />
        <button type="button" className={itemClass} onClick={() => onPick('drop')}>
          <Trash2 size={14} className="text-rose-600 group-hover:text-[var(--brand-gold)]" />
          <span>2. Drop Page</span>
        </button>
      </div>
    </div>
  );
}
