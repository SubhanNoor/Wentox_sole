import { useState } from 'react';
import { PencilLine, X } from 'lucide-react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

// Rename prompt for a Quick Menu shortcut (per the user, 2026-11-26). Only the shortcut's own label
// changes — the page's real title stays as it is. Pressing Enter on an empty box keeps the name it
// already had, so it is never left blank.
interface QuickMenuRenameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onRename: (name: string) => void;
}

export default function QuickMenuRenameModal(props: QuickMenuRenameModalProps) {
  useEscapeToClose(props.isOpen, props.onClose);
  // Mounted fresh on every open, so the box always starts empty.
  return props.isOpen ? <RenameDialog {...props} /> : null;
}

function RenameDialog({ currentName, onClose, onRename }: QuickMenuRenameModalProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    // Blank → keep the previous name.
    onRename(trimmed || currentName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="bg-[#111c2a] p-5 text-white flex items-center justify-between border-b border-[#B08D57]/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#B08D57]/20 border border-[#B08D57]/40 text-[#B08D57]">
              <PencilLine size={22} />
            </div>
            <div>
              <h3 className="font-lora font-bold text-base text-[#B08D57]">Change Name</h3>
              <p className="text-xs text-slate-300 font-inter mt-0.5">
                Current: <span className="font-bold text-white">{currentName}</span>
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <p className="text-xs font-semibold text-slate-600 mb-4 leading-relaxed">
            Enter the new name for this Quick Menu button. Only the Quick Menu name changes, not the
            page itself. Leave it empty and press Enter to keep the current name.
          </p>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={currentName}
            maxLength={40}
            className="soleria-input w-full py-2.5 text-xs font-semibold mb-5"
          />
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-lg transition-all shadow-sm"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
