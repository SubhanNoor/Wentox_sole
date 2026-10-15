import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  Plus, Trash2, Edit, Save, CheckCircle2, X, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
  Printer, Search, Undo2, PackageCheck, LogOut, FilePlus2, FileDown, FileSpreadsheet,
} from 'lucide-react';
import { TOOLBAR_SHORTCUTS, matchToolbarShortcut, findVisiblePreviewButton } from '@/lib/toolbarShortcuts';
import type { ToolbarActionId } from '@/lib/toolbarShortcuts';
import { isAnyDialogOpen } from '@/hooks/useEscapeToClose';

/**
 * The ONE document toolbar, shared by every entry page (per the user, 2026-09-20: "there are huge
 * inconsistencies in the app — journal voucher toolbar behaves different, in sale bill/return
 * different, in receipt/payment different"). Sale Bill's toolbar is the agreed standard, so this is
 * its button set, order, labels and icon colours, lifted verbatim:
 *
 *   New · Delete · Edit Row · Edit · Save · Done · Cancel │ First · Pre. · Next · Last │
 *   Print · Find │ Un Post · Post │ Exit │ Save+Post · Post All · PDF · Excel
 *
 * Every action ALWAYS renders — only `disabled` changes per page and per state, never whole groups
 * mounting and unmounting, so the same action sits in the same place on every screen. An action a
 * page does not pass renders disabled for exactly that reason.
 *
 * Icon colour signals the nature of the action, not the page: emerald = create/confirm, rose =
 * delete/destructive, sky = edit, blue = save, slate = neutral, amber = navigation.
 *
 * Keyboard shortcuts (per the user, 2026-10-16; mapping in lib/toolbarShortcuts.ts): Alt+N New,
 * Alt+S Save, Alt+D Done and so on. A shortcut presses the button exactly like a click, so a
 * disabled or hidden button does nothing, and nothing fires while a dialog is open.
 */
export interface ToolbarAction {
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  /** Tooltip; falls back to the button's own label. */
  title?: string;
}

export interface DocumentToolbarProps {
  newAction?: ToolbarAction & { ref?: RefObject<HTMLButtonElement | null> };
  remove?: ToolbarAction;
  editRow?: ToolbarAction;
  edit?: ToolbarAction;
  save?: ToolbarAction & { submit?: boolean; form?: string };
  /** Rendered as type="submit" like Sale Bill's own Done, so a page's <form> onSubmit still fires. */
  done?: ToolbarAction & { submit?: boolean; form?: string };
  cancel?: ToolbarAction;
  first?: ToolbarAction;
  prev?: ToolbarAction;
  next?: ToolbarAction;
  last?: ToolbarAction;
  print?: ToolbarAction;
  find?: ToolbarAction;
  unpost?: ToolbarAction;
  post?: ToolbarAction;
  exit?: ToolbarAction;
  saveAndPost?: ToolbarAction;
  postAll?: ToolbarAction & { count?: number };
  pdf?: ToolbarAction;
  excel?: ToolbarAction;
  /** Page-specific extras (e.g. the Posted/Unposted dropdown) rendered after the standard set. */
  children?: ReactNode;
}

// The button's shortcut letter, underlined in its label (New, Save, ...). Only plain Alt+letter
// shortcuts whose letter is in the label; Alt+Delete, Alt+V on Print, the arrows etc. are in the tooltip.
function labelWithMnemonic(label: string, id: ToolbarActionId): ReactNode {
  const s = TOOLBAR_SHORTCUTS[id];
  if (s.shift || !s.code.startsWith('Key')) return label;
  const i = label.toUpperCase().indexOf(s.code.slice(3));
  if (i < 0) return label;
  return <>{label.slice(0, i)}<u>{label[i]}</u>{label.slice(i + 1)}</>;
}

function Btn({
  id, action, label, icon, submit, form, buttonRef,
}: {
  /** Its keyboard shortcut; PDF and Excel have none. */
  id?: ToolbarActionId;
  action?: ToolbarAction;
  label: string;
  icon: ReactNode;
  submit?: boolean;
  /** For a submit button rendered OUTSIDE its <form> (Purchase/Stock/Journal Voucher entry cards). */
  form?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type={submit ? 'submit' : 'button'}
      form={form}
      onClick={action?.onClick}
      // A submit button needs no onClick — the form's own onSubmit does the work.
      disabled={!(action?.onClick || submit) || action?.disabled}
      title={id ? `${action?.title ?? label} (${TOOLBAR_SHORTCUTS[id].hint})` : action?.title ?? label}
      className="toolbar-btn"
      data-shortcut={id}
    >
      {icon}
      <span>{id ? labelWithMnemonic(label, id) : label}</span>
    </button>
  );
}

function Divider() {
  return <span className="w-px self-stretch mx-0.5 shrink-0" style={{ background: 'var(--border-color)' }} />;
}

export default function DocumentToolbar(props: DocumentToolbarProps) {
  const { newAction, remove, editRow, edit, save, done, cancel, first, prev, next, last,
    print, find, unpost, post, exit, saveAndPost, postAll, pdf, excel, children } = props;
  const ic = (C: typeof Plus, color: string) => <C size={16} strokeWidth={2.5} className={color} />;
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const id = matchToolbarShortcut(e);
      const bar = barRef.current;
      // offsetParent is null while the bar is hidden (another tab of the page is showing).
      if (!id || !bar || bar.offsetParent === null || isAnyDialogOpen()) return;
      // Alt+V stays G-09's print preview where a tab shows its own "Show Print Preview" button
      // (e.g. Sale Bill's Find tab); AppLayout presses that one.
      if (id === 'print' && findVisiblePreviewButton()) return;
      // Captured before any field sees it: Alt+C must not also flip Receipts' payment mode (C).
      e.preventDefault();
      e.stopPropagation();
      const btn = bar.querySelector<HTMLButtonElement>(`button[data-shortcut="${id}"]`);
      if (!btn || btn.disabled) return;
      // Like a mouse click: the field being typed in loses focus first, so whatever commits on
      // blur is in before the button acts, then the cursor goes back to that field.
      const field = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : null;
      field?.blur();
      setTimeout(() => {
        if (btn.disabled || !btn.isConnected) { field?.focus(); return; }
        btn.click();
        // Only when the action moved focus nowhere itself (New focuses its own first field, etc.).
        setTimeout(() => {
          const now = document.activeElement;
          if (field?.isConnected && (now === null || now === document.body) && !isAnyDialogOpen()) field.focus();
        }, 0);
      }, 0);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <div ref={barRef} className="flex items-center gap-2 min-w-0 flex-nowrap overflow-x-auto">
      <div className="flex items-center gap-0.5 flex-nowrap">
        <Btn id="newAction" action={newAction} buttonRef={newAction?.ref} label="New" icon={ic(Plus, 'text-emerald-600')} />
        <Btn id="remove" action={remove} label="Delete" icon={ic(Trash2, 'text-rose-600')} />
        <Btn id="editRow" action={editRow} label="Edit Row" icon={ic(Edit, 'text-sky-600')} />
        <Btn id="edit" action={edit} label="Edit" icon={ic(Edit, 'text-sky-600')} />
        <Btn id="save" action={save} submit={save?.submit} form={save?.form} label="Save" icon={ic(Save, 'text-blue-600')} />
        <Btn id="done" action={done} submit={done?.submit} form={done?.form} label="Done" icon={ic(CheckCircle2, 'text-emerald-600')} />
        <Btn id="cancel" action={cancel} label="Cancel" icon={ic(X, 'text-slate-500')} />

        <Divider />

        <Btn id="first" action={first} label="First" icon={ic(ChevronsLeft, 'text-amber-600')} />
        <Btn id="prev" action={prev} label="Pre." icon={ic(ChevronLeft, 'text-amber-600')} />
        <Btn id="next" action={next} label="Next" icon={ic(ChevronRight, 'text-amber-600')} />
        <Btn id="last" action={last} label="Last" icon={ic(ChevronsRight, 'text-amber-600')} />

        <Divider />

        <Btn id="print" action={print} label="Print" icon={ic(Printer, 'text-slate-600')} />
        <Btn id="find" action={find} label="Find" icon={ic(Search, 'text-slate-600')} />

        <Divider />

        <Btn id="unpost" action={unpost} label="Un Post" icon={ic(Undo2, 'text-rose-600')} />
        <Btn id="post" action={post} label="Post" icon={ic(PackageCheck, 'text-emerald-600')} />

        <Divider />

        <Btn id="exit" action={exit} label="Exit" icon={ic(LogOut, 'text-slate-600')} />

        <Divider />

        <Btn id="saveAndPost" action={saveAndPost} label="Save+Post" icon={ic(FilePlus2, 'text-emerald-600')} />
        <Btn id="postAll"
          action={postAll}
          label="Post All"
          icon={ic(PackageCheck, 'text-emerald-600')}
        />
        <Btn action={pdf} label="PDF" icon={ic(FileDown, 'text-slate-600')} />
        <Btn action={excel} label="Excel" icon={ic(FileSpreadsheet, 'text-slate-600')} />
      </div>
      {children}
    </div>
  );
}
