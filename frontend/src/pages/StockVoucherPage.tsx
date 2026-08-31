import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import { focusNextField } from '@/lib/fieldNav';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';
import * as api from '@/lib/api';
import type {
  ProductRow, ProductVariantRow, StoreRow, StockVoucherRow, StockVoucherLineInput,
  StockVoucherCreateInput, UnpostedStockVoucherRow, PostAllResult, StockRow, BusinessAccountRow,
} from '@/lib/api';
import { formatDate, getTodayDate, toDateInputValue } from '@/lib/utils';
import {
  Edit, Search, Plus, Trash2, Boxes, ChevronDown, CheckCircle2, PackageCheck, Undo2,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Printer
} from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';

/**
 * Stock Voucher — a manual "add stock" document (legacy Journal Entry-style bound-record screen,
 * per the user 2026-08-26): N lines, each a finished-goods article/color + cartons/pairs, under
 * one Date/Store/On Account/Remarks header. Replaces the old inline "+ Add Stock" flow on the
 * Current Stock report, which recorded every manual addition AS production — this is its own
 * document type instead, same architecture as Journal Voucher (DRAFT by default, status flips to
 * CONFIRMED only on post(), which is the only thing that writes stock_movements).
 *
 * No valuation, no reference numbers, no ledger posting (per the user, 2026-08-30 follow-up — a
 * prior round briefly added Rate/D%/Value/Bill No./IGP No./Bilty No./Delivery and a ledger pair;
 * all removed again as unwanted scope). On Account is a pure reference field — no default, and
 * Main A/C always mirrors whatever it's set to, never independently editable.
 */

function newLineUid() {
  return 'svl_' + Date.now() + Math.random().toString(36).slice(2, 7);
}

// Compact label-left field — ref-pic parity (stock.png): a small fixed-width label beside the
// input instead of a label stacked above it, so the whole header reads as one dense bound-record
// card rather than a stack of separate boxes. `gridArea` places it in the header's own named grid.
function CompactField({
  label, required, gridArea, children,
}: { label: string; required?: boolean; gridArea?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0" style={gridArea ? { gridArea } : undefined}>
      <label className="text-[11px] font-semibold text-slate-600 whitespace-nowrap shrink-0" style={{ width: '72px' }}>
        {label}{required && <span className="text-red-500 font-bold"> *</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// The committed shape, read-only in the grid and hydrated by loadSv.
interface UiLine {
  uid: string;
  articleId: number | null;
  variantId: number | null;
  label: string; // "Article Name — Color"
  articleCode: string;
  categoryName: string;
  packing: number;
  cartons: number;
  pairs: number;
}

// The entry strip's own "one line being typed" shape.
interface EntryLine {
  articleId: number | null;
  variantId: number | null;
  articleSearchText: string; // what's typed/shown in the Article Code field
  label: string;
  categoryName: string;
  packing: number;
  cartons: number;
  pairs: number;
}

function emptyEntry(): EntryLine {
  return {
    articleId: null, variantId: null, articleSearchText: '', label: '', categoryName: '',
    packing: 0, cartons: 0, pairs: 0,
  };
}

export default function StockVoucherPage() {
  const { dispatch } = useApp();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [variantsByArticle, setVariantsByArticle] = useState<Record<number, ProductVariantRow[]>>({});
  const [vouchers, setVouchers] = useState<StockVoucherRow[]>([]);
  const [lookupError, setLookupError] = useState('');

  // Stock Voucher Ledger — search + status filter, both applied server-side.
  const [svSearch, setSvSearch] = useState('');
  const [svStatusFilter, setSvStatusFilter] = useState<'all' | 'CONFIRMED' | 'DRAFT'>('all');

  const refresh = useCallback(async () => {
    const res = await api.stockVouchers.list({
      search: svSearch.trim() || undefined,
      status: svStatusFilter === 'all' ? undefined : svStatusFilter,
    });
    if (res.ok) setVouchers(res.data);
    else setLookupError('Failed to load stock vouchers: ' + res.error.message);
  }, [svSearch, svStatusFilter]);

  // Stock vouchers saved but not yet posted, so a run can be entered first and posted together.
  const [unpostedSvs, setUnpostedSvs] = useState<UnpostedStockVoucherRow[]>([]);
  const [postAllBusy, setPostAllBusy] = useState(false);
  const [postAllResult, setPostAllResult] = useState<PostAllResult<'stock_voucher_id'> | null>(null);
  const [postingSvId, setPostingSvId] = useState<number | null>(null);

  const refreshUnposted = useCallback(async () => {
    const res = await api.stockVouchers.listUnposted();
    if (res.ok) setUnpostedSvs(res.data);
  }, []);

  const fetchVariants = useCallback(async (articleId: number) => {
    if (variantsByArticle[articleId]) return variantsByArticle[articleId];
    const res = await api.listProductVariants(articleId);
    if (res.ok) {
      setVariantsByArticle(prev => ({ ...prev, [articleId]: res.data }));
      return res.data;
    }
    return [];
  }, [variantsByArticle]);

  useEffect(() => {
    (async () => {
      const [p, st, ba] = await Promise.all([api.listProducts(), api.listStores(), api.listBusinessAccounts()]);
      if (p.ok) setProducts(p.data); else setLookupError('Failed to load products: ' + p.error.message);
      if (st.ok) setStores(st.data); else setLookupError('Failed to load stores: ' + st.error.message);
      if (ba.ok) setBusinessAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
    })();
    refreshUnposted();
  }, [refreshUnposted]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const handlePostAll = async () => {
    setPostAllBusy(true);
    const res = await api.stockVouchers.postAll();
    setPostAllBusy(false);
    if (!res.ok) { fail('Failed to post all: ' + res.error.message); return; }
    setPostAllResult(res.data);
    refresh();
    refreshUnposted();
    refreshNav();
    const workingDate = date;
    handleNew();
    setDate(workingDate);
  };

  // Recorded Stock Vouchers moved to its own tab — mirrors JournalVoucherPage/PurchasePage.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');

  // ── entry form ──
  const [mode, setMode] = useState<'new' | 'edit' | 'view'>('new');
  const [svId, setSvId] = useState<number | null>(null);
  const [status, setStatus] = useState<'CONFIRMED' | 'DRAFT'>('DRAFT');
  // A New Stock Voucher's own in-progress fields persist across switching pages AND an app
  // restart (usePersistentField — see src/hooks/usePersistentField.ts), so typing one up and
  // getting pulled away mid-entry never loses it. Deliberately NOT applied to mode/svId/status —
  // an already-saved voucher loaded for view/edit is safely re-openable by id at any time, so
  // caching it risks showing a stale copy instead; only unsaved "new" work is ever at risk of
  // being lost for good.
  const clearStockVoucherDraft = useClearPageDraft('stock-voucher');
  const [date, setDate] = usePersistentField('stock-voucher', 'date', getTodayDate());
  const [storeId, setStoreId] = usePersistentField('stock-voucher', 'storeId', '');
  const [remarks, setRemarks] = usePersistentField('stock-voucher', 'remarks', '');
  const [lines, setLines] = usePersistentField<UiLine[]>('stock-voucher', 'lines', []);

  // On Account — pure reference field, per the user (2026-08-30): no default selection, and
  // Main A/C is never a separate value, it always mirrors whatever this is set to.
  const [accountBaId, setAccountBaId] = usePersistentField('stock-voucher', 'accountBaId', '');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 2000); };

  const isViewMode = mode === 'view';
  const isPosted = status === 'CONFIRMED';

  const storeOptions = useMemo(
    () => stores.map(s => ({ value: String(s.store_id), label: s.name })),
    [stores]
  );

  const handleNew = () => {
    setMode('new'); setSvId(null); setStatus('DRAFT');
    setDate(getTodayDate()); setStoreId(''); setRemarks('');
    setAccountBaId('');
    setLines([]);
    setEntry(emptyEntry());
    setEditingIndex(null);
    setErrorMsg('');
    clearStockVoucherDraft();
    // Explicit focus, not just a mode-change effect: clicking New while already on a blank/new
    // voucher (mode is already 'new') wouldn't otherwise re-trigger any such effect, so focus
    // would stay wherever it was (same fix as SaleBillPage/JournalVoucherPage's own handleNew).
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  };

  // Store field — typable <input> opening the same centered SearchModal popup as every other
  // lookup in the app.
  const storeTriggerRef = useRef<HTMLInputElement>(null);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [storeSearchText, setStoreSearchText] = useState('');
  const [storeModalSeed, setStoreModalSeed] = useState('');
  useEffect(() => {
    const opt = storeOptions.find(o => o.value === storeId);
    setStoreSearchText(opt?.label ?? '');
  }, [storeId, storeOptions]);
  const openStoreModal = () => {
    if (isViewMode) return;
    setStoreModalSeed('');
    setIsStoreModalOpen(true);
  };
  function handleStoreTriggerKeyDown(e: React.KeyboardEvent) {
    // stopPropagation on every branch — otherwise this keydown keeps bubbling past the trigger up
    // to window-level listeners (AppLayout's own G-01 field-walk), acting on it at the same time
    // the modal opens. Same reasoning as SearchModal's own internal keydown handling.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openStoreModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setStoreModalSeed(storeSearchText);
      setIsStoreModalOpen(true);
    }
  }

  // On Account field — same typable-trigger + centered SearchModal popup as Store, per the user
  // (2026-08-30). No default — blank until the user actually picks something.
  const accountOptions = useMemo(
    // Business accounts show their PARENT chart account inline, appended to the same field with an em-dash rather than in a field of its own (2026-08-30, per the user). Matches how ReceiptsPage's own account picker already reads. `ac_name` is joined in by businessAccounts.repository.js's list().
    () => businessAccounts.map(a => ({
      value: String(a.ba_id),
      label: `${a.name} (${a.code})${a.ac_name ? ` — ${a.ac_name}` : ''}`,
    })),
    [businessAccounts]
  );
  const selectedAccount = useMemo(
    () => businessAccounts.find(a => String(a.ba_id) === accountBaId),
    [businessAccounts, accountBaId]
  );
  const accountTriggerRef = useRef<HTMLInputElement>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountSearchText, setAccountSearchText] = useState('');
  const [accountModalSeed, setAccountModalSeed] = useState('');
  useEffect(() => {
    setAccountSearchText(selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : '');
  }, [selectedAccount]);
  const openAccountModal = () => {
    if (isViewMode) return;
    setAccountModalSeed('');
    setIsAccountModalOpen(true);
  };
  function handleAccountTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openAccountModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setAccountModalSeed(accountSearchText);
      setIsAccountModalOpen(true);
    }
  }

  // ── Entry strip (ref-pic bound-record pattern, per the user 2026-08-26) — ONE editable Article
  // Code/Product Name/Color/Cartons/Pairs row, NOT one editable row per grid line. Cartons is
  // typed; Pairs is auto-computed from the article/color's own packing (same convention as Sale
  // Bill/Purchase). Enter on Cartons (the strip's last editable field — Pairs stays disabled/
  // auto) commits the line into `lines` — appending, or replacing `editingIndex` when a grid row
  // was clicked to re-open it — then always clears the strip and refocuses Article Code for the
  // next line (per the user: "mouse goes back to the first article field... modal pop up") —
  // Date/Store/Remarks above are never touched by this.
  const [entry, setEntry] = usePersistentField<EntryLine>('stock-voucher', 'entry', emptyEntry());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Stock in Hand — read-only readout in the entry strip (ref-pic parity), looked up from the
  // Current Stock rollup (api.reports.stock) by variant_id whenever the picked color changes.
  // Store-agnostic, same as the rest of this app's finished-goods stock (stock_movements carries
  // no store_id) — not scoped to the voucher's own Store field.
  const [stockInHand, setStockInHand] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (entry.articleId == null || entry.variantId == null) { setStockInHand(null); return; }
    (async () => {
      const res = await api.reports.stock({ article_id: entry.articleId! });
      if (cancelled || !res.ok) return;
      const row = res.data.find((r: StockRow) => r.variant_id === entry.variantId);
      setStockInHand(row ? Number(row.total_pairs) : 0);
    })();
    return () => { cancelled = true; };
  }, [entry.articleId, entry.variantId]);

  const entryArticleTriggerRef = useRef<HTMLInputElement>(null);
  const [isEntryArticleModalOpen, setIsEntryArticleModalOpen] = useState(false);
  const [entryArticleModalSeed, setEntryArticleModalSeed] = useState('');

  // "+ Add New Color" — a sentinel option in the Color dropdown swaps it for a free-text input;
  // confirming resolves-or-creates the article_colors row via the same endpoint the old Current
  // Stock "+ Add Stock" flow used, then selects it like any other color.
  const NEW_COLOR_SENTINEL = '__new_color__';
  const [isAddingColor, setIsAddingColor] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [creatingColor, setCreatingColor] = useState(false);
  const newColorInputRef = useRef<HTMLInputElement>(null);
  // Every reset point (new line, row loaded for edit, commit, Cancel) changes entry.articleId —
  // fold back to the plain dropdown from any of them at once instead of by hand at each one.
  useEffect(() => {
    setIsAddingColor(false);
    setNewColorName('');
  }, [entry.articleId]);
  // Explicit focus, not the input's own `autoFocus` — picking "+ Add New Color..." swaps this
  // field in at the same moment the SearchModal it was picked from is unmounting, and that
  // teardown was winning the race against the new input's autoFocus (reported by the user,
  // 2026-08-26: it never actually landed focus). requestAnimationFrame runs after that unmount
  // settles, same fix pattern used for every other modal-driven focus-hop on this page.
  useEffect(() => {
    if (isAddingColor) requestAnimationFrame(() => newColorInputRef.current?.focus());
  }, [isAddingColor]);

  // Color field — same typable-trigger + centered SearchModal popup as Article/Store, per the
  // user (2026-08-26). Options include the "+ Add New Color..." sentinel above, which swaps the
  // whole field for a free-text input instead (handleEntryVariantChange detects it).
  const colorTriggerRef = useRef<HTMLInputElement>(null);
  // Cartons sits directly under Color now (2026-08-26 layout request) and is also where focus
  // lands once a freshly-created color is confirmed, so the "+ Add New Color" flow reads as one
  // continuous hop: pick "+ Add New Color..." -> type name -> Enter -> straight into Cartons.
  const cartonsInputRef = useRef<HTMLInputElement>(null);
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [colorSearchText, setColorSearchText] = useState('');
  const [colorModalSeed, setColorModalSeed] = useState('');
  useEffect(() => {
    const variants = entry.articleId != null ? variantsByArticle[entry.articleId] || [] : [];
    const variant = variants.find(v => v.variant_id === entry.variantId);
    setColorSearchText(variant?.color ?? '');
  }, [entry.variantId, entry.articleId, variantsByArticle]);
  const openColorModal = () => {
    if (isViewMode || entry.articleId == null) return;
    setColorModalSeed('');
    setIsColorModalOpen(true);
  };
  function handleColorTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openColorModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode || entry.articleId == null) return;
      setColorModalSeed(colorSearchText);
      setIsColorModalOpen(true);
    }
  }

  const openEntryArticleModal = () => {
    if (isViewMode) return;
    setEntryArticleModalSeed('');
    setIsEntryArticleModalOpen(true);
  };
  const handleEntryArticleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openEntryArticleModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setEntryArticleModalSeed(entry.articleSearchText);
      setIsEntryArticleModalOpen(true);
    }
  };
  const handleEntryArticleSelect = async (val: string) => {
    const articleId = val ? Number(val) : null;
    const product = articleId != null ? products.find(p => p.article_id === articleId) : undefined;
    setEntry(prev => ({
      ...prev,
      articleId,
      variantId: null,
      articleSearchText: product ? `${product.code} — ${product.name}` : '',
      label: product?.name || '',
      categoryName: product?.category_name || '',
      packing: product?.packing || 0,
    }));
    setIsEntryArticleModalOpen(false);
    if (articleId != null) await fetchVariants(articleId);
    requestAnimationFrame(() => focusNextField(entryArticleTriggerRef.current));
  };

  const handleEntryVariantChange = (variantIdStr: string) => {
    if (entry.articleId == null) return;
    if (variantIdStr === NEW_COLOR_SENTINEL) {
      setNewColorName('');
      setIsAddingColor(true);
      return;
    }
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const variant = variantsByArticle[entry.articleId]?.find(v => v.variant_id === variantId);
    const product = products.find(p => p.article_id === entry.articleId);
    setEntry(prev => {
      const packing = variant?.packing ?? product?.packing ?? prev.packing;
      return {
        ...prev,
        variantId,
        label: variant ? `${product?.name || ''} — ${variant.color}` : (product?.name || ''),
        packing,
        pairs: prev.cartons * packing,
      };
    });
  };

  // Resolves-or-creates the article_colors row for the typed name, refreshes the cached variant
  // list for this article so it shows up immediately, then selects it like any other color.
  const handleCreateColor = async () => {
    if (entry.articleId == null || !newColorName.trim()) return;
    setCreatingColor(true);
    const res = await api.productColors.resolveOrCreate({
      article_id: entry.articleId,
      color: newColorName.trim(),
    });
    setCreatingColor(false);
    if (!res.ok) {
      fail('Failed to add color: ' + res.error.message);
      return;
    }
    const variant = res.data;
    setVariantsByArticle(prev => {
      const existing = prev[entry.articleId!] || [];
      const already = existing.some(v => v.variant_id === variant.variant_id);
      return { ...prev, [entry.articleId!]: already ? existing : [...existing, variant] };
    });
    setIsAddingColor(false);
    setNewColorName('');
    // Select it directly from `variant` rather than via handleEntryVariantChange — that reads
    // variantsByArticle from its own closure, which still holds the pre-create value here.
    const product = products.find(p => p.article_id === entry.articleId);
    setEntry(prev => {
      const packing = variant.packing ?? product?.packing ?? prev.packing;
      return {
        ...prev,
        variantId: variant.variant_id,
        label: `${product?.name || ''} — ${variant.color}`,
        packing,
        pairs: prev.cartons * packing,
      };
    });
    requestAnimationFrame(() => cartonsInputRef.current?.focus());
  };

  const updateEntryCartons = (cartons: number) => {
    setEntry(prev => ({ ...prev, cartons, pairs: cartons * prev.packing }));
  };

  const handleCommitLine = () => {
    if (entry.articleId == null || entry.variantId == null) {
      fail('Select an article and color before adding the line.');
      return;
    }
    if (entry.cartons <= 0) { fail('Cartons must be greater than 0.'); return; }
    if (entry.pairs <= 0) { fail('Pairs must be greater than 0 — check the article\'s packing.'); return; }
    setErrorMsg('');
    const product = products.find(p => p.article_id === entry.articleId);
    const committed: UiLine = {
      uid: editingIndex != null ? lines[editingIndex].uid : newLineUid(),
      articleId: entry.articleId,
      variantId: entry.variantId,
      label: entry.label,
      articleCode: product?.code || '',
      categoryName: entry.categoryName,
      packing: entry.packing,
      cartons: entry.cartons,
      pairs: entry.pairs,
    };
    // Same article/color already on the grid — merge into it instead of adding a duplicate row
    // (per the user, 2026-08-30). Excludes the row being edited itself, so re-committing an
    // unchanged line doesn't fold it into a copy of itself.
    const dupIdx = lines.findIndex((l, i) => l.variantId === committed.variantId && i !== editingIndex);
    if (dupIdx !== -1) {
      setLines(prev => {
        const withoutEditing = editingIndex != null ? prev.filter((_, i) => i !== editingIndex) : prev;
        const mergeIdx = withoutEditing.findIndex(l => l.variantId === committed.variantId);
        return withoutEditing.map((l, i) => i === mergeIdx
          ? { ...l, cartons: l.cartons + committed.cartons, pairs: l.pairs + committed.pairs }
          : l);
      });
      flash(`${committed.label} was already on the list — quantity merged into that line.`);
    } else if (editingIndex != null) {
      setLines(prev => prev.map((l, i) => i === editingIndex ? committed : l));
    } else {
      setLines(prev => [...prev, committed]);
    }
    setEditingIndex(null);
    setEntry(emptyEntry());
    requestAnimationFrame(() => entryArticleTriggerRef.current?.focus());
  };

  // Enter on Cartons — the strip's last editable field — commits the line and resets straight
  // back to Article Code.
  function handleCartonsKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    // Cartons must be at least 1 before Enter commits — an empty/0 Cartons field used to still
    // commit a line with 0 cartons (reported by the user).
    if (entry.cartons <= 0) { fail('Cartons must be at least 1.'); return; }
    handleCommitLine();
  }

  // Loads an already-committed line back into the strip for editing (grid row click).
  const loadLineIntoEntry = (idx: number) => {
    const row = lines[idx];
    setEntry({
      articleId: row.articleId, variantId: row.variantId, articleSearchText: row.articleCode ? `${row.articleCode} — ${row.label.split(' — ')[0]}` : row.label,
      label: row.label, categoryName: row.categoryName, packing: row.packing, cartons: row.cartons, pairs: row.pairs,
    });
    setEditingIndex(idx);
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => entryArticleTriggerRef.current?.focus());
  };

  const handleRowClick = (idx: number) => {
    if (isViewMode) setMode('edit');
    loadLineIntoEntry(idx);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEntry(emptyEntry());
    } else if (editingIndex != null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  // Toolbar's Delete is dual-purpose, same convention as SaleBillPage/JournalVoucherPage: with a
  // line loaded into the strip for editing, it removes THAT line; otherwise it's the whole-voucher
  // delete (currently-open unposted voucher).
  const handleDeleteAction = () => {
    if (editingIndex != null) {
      removeLine(editingIndex);
      return;
    }
    if (svId == null || isPosted) return;
    pendingDeleteSvId.current = svId;
    setIsPasswordModalOpen(true);
  };

  const totals = useMemo(() => {
    const totalCartons = lines.reduce((s, l) => s + (Number(l.cartons) || 0), 0);
    const totalPairs = lines.reduce((s, l) => s + (Number(l.pairs) || 0), 0);
    return { totalCartons, totalPairs };
  }, [lines]);

  const isValid = useMemo(() => {
    if (!date || !storeId) return false;
    if (lines.length < 1) return false;
    if (!lines.every(l => l.variantId && l.cartons > 0 && l.pairs > 0)) return false;
    return true;
  }, [date, storeId, lines]);

  const buildPayload = (): StockVoucherCreateInput | null => {
    if (!date) { fail('Please pick a date.'); return null; }
    if (!storeId) { fail('Store is required.'); return null; }
    if (lines.length < 1) { fail('A Stock Voucher needs at least 1 line.'); return null; }
    if (!lines.every(l => l.variantId)) { fail('Every line needs an article/color.'); return null; }
    if (!lines.every(l => l.pairs > 0)) {
      fail('Every line needs pairs greater than 0.'); return null;
    }
    const payloadLines: StockVoucherLineInput[] = lines.map(l => ({
      variant_id: l.variantId!,
      cartons: l.cartons,
      pairs: l.pairs,
    }));
    return {
      voucher_date: date,
      store_id: Number(storeId),
      remarks: remarks.trim() || undefined,
      on_account_ba_id: accountBaId ? Number(accountBaId) : null,
      lines: payloadLines,
    };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    const result = mode === 'edit' && svId != null
      ? await api.stockVouchers.update(svId, payload)
      : await api.stockVouchers.create(payload);
    if (!result.ok) { fail('Failed to save Stock Voucher: ' + result.error.message); return; }
    setSvId(result.data.stock_voucher_id);
    setStatus(result.data.status);
    setErrorMsg('');
    flash('Stock Voucher saved — Post it to update stock.');
    setMode('view');
    clearStockVoucherDraft();
    refresh();
    refreshUnposted();
    refreshNav();
  };

  // Posting finishes this voucher and readies the form for the next one — same convention as
  // Sale Bill/Journal Voucher's own "clear straight back to blank so the next can be typed
  // immediately".
  const handlePost = async () => {
    if (svId == null) return;
    const res = await api.stockVouchers.post(svId);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    flash('Stock Voucher posted — stock updated.');
    refresh();
    refreshUnposted();
    refreshNav();
    const workingDate = date;
    handleNew();
    setDate(workingDate);
  };

  const handleUnpost = async () => {
    if (svId == null) return;
    const res = await api.stockVouchers.unpost(svId);
    if (!res.ok) { fail('Failed to unpost: ' + res.error.message); return; }
    setStatus(res.data.status);
    flash('Stock Voucher unposted.');
    refresh();
    refreshUnposted();
    refreshNav();
    // It's a draft again now, so the window follows it back to the Unposted view (per the user,
    // 2026-08-30) rather than staying on Posted looking at a record that no longer belongs there.
    setBrowseFilter('unposted');
  };

  // Listing rows only carry rolled-up totals, not the per-line detail — loading a voucher always
  // re-fetches the full record (with lines) to hydrate the form.
  const loadSv = async (id: number) => {
    const res = await api.stockVouchers.get(id);
    if (!res.ok) { fail('Failed to load Stock Voucher: ' + res.error.message); return; }
    const sv = res.data;
    setSvId(sv.stock_voucher_id);
    setStatus(sv.status);
    setDate(toDateInputValue(sv.voucher_date));
    setStoreId(sv.store_id != null ? String(sv.store_id) : '');
    setRemarks(sv.remarks || '');
    setAccountBaId(sv.on_account_ba_id != null ? String(sv.on_account_ba_id) : '');
    setLines((sv.lines || []).map(l => ({
      uid: 'svl_' + l.line_id,
      articleId: l.article_id ?? null,
      variantId: l.variant_id,
      label: `${l.article_name || l.article_code || 'Article'} — ${l.color || ''}`,
      articleCode: l.article_code || '',
      // Not returned by the lines join — looked up from the already-loaded products list by
      // article_id, same as the entry strip does when an article is freshly picked.
      categoryName: products.find(p => p.article_id === l.article_id)?.category_name || '',
      // cartons can legally be 0 (a pairs-only manual adjustment) — pairs/cartons would zero out
      // packing then, silently corrupting the line if it's re-edited and cartons gets typed in
      // (updateEntryCartons derives pairs from packing). Falls back to the article's own packing.
      packing: l.cartons ? l.pairs / l.cartons : (products.find(p => p.article_id === l.article_id)?.packing || 0),
      cartons: l.cartons,
      pairs: l.pairs,
    })));
    (sv.lines || []).forEach(l => { if (l.article_id != null) fetchVariants(l.article_id); });
    setEntry(emptyEntry());
    setEditingIndex(null);
    setErrorMsg('');
    setMode('view');
  };

  const loadRow = (row: StockVoucherRow) => { loadSv(row.stock_voucher_id); setActiveTab('entry'); };

  // Pending Posting sidebar: opening a row loads that voucher straight into the form.
  const handleOpenUnposted = (id: number) => { loadSv(id); setActiveTab('entry'); };

  // Posts a single voucher straight from the sidebar without loading it into the form.
  const handlePostOneUnposted = async (targetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPostingSvId(targetId);
    const res = await api.stockVouchers.post(targetId);
    setPostingSvId(null);
    if (!res.ok) { fail('Failed to post: ' + res.error.message); return; }
    flash(`Stock Voucher #${res.data.stock_voucher_id} posted.`);
    refresh();
    refreshUnposted();
    refreshNav();
    if (targetId === svId) setStatus(res.data.status);
  };

  // Password-gated (verified server-side) — deleting a saved-unposted voucher is destructive with
  // no reverse-never-erase trail, same guard level used everywhere else.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteSvId = useRef<number | null>(null);

  const handleDeleteUnposted = (targetId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    pendingDeleteSvId.current = targetId;
    setIsPasswordModalOpen(true);
  };

  const handleDeletePasswordSuccess = async (password: string) => {
    setIsPasswordModalOpen(false);
    const targetId = pendingDeleteSvId.current;
    pendingDeleteSvId.current = null;
    if (targetId == null) return;
    const res = await api.stockVouchers.remove(targetId, password);
    if (!res.ok) { fail('Failed to delete: ' + res.error.message); return; }
    flash('Stock Voucher deleted successfully.');
    if (svId === targetId) handleNew();
    refresh();
    refreshUnposted();
    refreshNav();
  };

  // Entry card fills whatever vertical space is left in the viewport below it — mirrors
  // JournalVoucherPage/SaleBillPage.
  const entryCardRef = useRef<HTMLFormElement>(null);
  const [entryCardHeight, setEntryCardHeight] = useState<number | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // G-01: auto-focus Date whenever the entry tab becomes the active, editable view — including
  // the very first time the page itself is opened.
  useEffect(() => {
    if (activeTab === 'entry' && mode !== 'view') {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [activeTab, mode]);

  useEffect(() => {
    function recompute() {
      const el = entryCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setEntryCardHeight(Math.max(320, window.innerHeight - top - 32));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode]);

  // ── Record navigation: First/Pre./Next/Last + Posted/Unposted dropdown — same mechanism as
  // JournalVoucherPage §. Fetched unfiltered, newest-first — reversed here for oldest-first
  // browsing, so First = earliest, Last = most recent. Also doubles as the source for the auto
  // "Number" preview below, since stock_voucher_id is the ONE identity a voucher ever has.
  //
  // Unposted is the default (per the user, 2026-08-30): that's the working mode you add and post
  // new vouchers from. Posted is purely a browse mode over already-CONFIRMED vouchers (First/
  // Prev./Next/Last + Un Post) — switching into it never blocks entry, it's just a different lens
  // on the same record list.
  const [browseFilter, setBrowseFilter] = useState<'posted' | 'unposted'>('unposted');
  const [navVouchers, setNavVouchers] = useState<StockVoucherRow[]>([]);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const refreshNav = useCallback(async () => {
    const res = await api.stockVouchers.list({});
    if (res.ok) setNavVouchers(res.data);
    return res.ok ? res.data : null;
  }, []);

  useEffect(() => { refreshNav(); }, [refreshNav]);

  const navPostedList = useMemo(
    () => [...navVouchers].filter(v => v.status === 'CONFIRMED').reverse(),
    [navVouchers]
  );

  const navIndex = useMemo(() => {
    if (svId == null || !isPosted) return -1;
    return navPostedList.findIndex(v => v.stock_voucher_id === svId);
  }, [svId, isPosted, navPostedList]);

  const canBrowse = browseFilter === 'posted' && navPostedList.length > 0;
  const canNavPrevious = canBrowse && navIndex !== 0;
  const canNavNext = canBrowse && navIndex !== navPostedList.length - 1;

  const goToNavIndex = async (idx: number) => {
    if (idx < 0 || idx >= navPostedList.length) return;
    await loadSv(navPostedList[idx].stock_voucher_id);
  };
  const handleFirst = () => goToNavIndex(0);
  const handlePrev = () => goToNavIndex(navIndex === -1 ? 0 : navIndex - 1);
  const handleNext = () => goToNavIndex(navIndex === -1 ? 0 : navIndex + 1);
  const handleLast = () => goToNavIndex(navPostedList.length - 1);

  // Switching the Posted/Unposted dropdown (per the user, 2026-08-30):
  // - To Unposted: load the most recently saved unposted voucher (or a blank New one if there
  //   isn't one), then focus New — Enter on it clicks New and lands on Date, ready to type the
  //   next voucher, same as today.
  // - To Posted: re-fetch and jump straight to the most recently posted voucher for browsing.
  const handleBrowseFilterChange = async (next: 'posted' | 'unposted') => {
    setBrowseFilter(next);
    if (next === 'unposted') {
      const latest = unpostedSvs[unpostedSvs.length - 1];
      if (latest) await loadSv(latest.stock_voucher_id);
      else handleNew();
      requestAnimationFrame(() => newButtonRef.current?.focus());
    } else {
      const fresh = await refreshNav();
      const list = [...(fresh ?? navVouchers)].filter(v => v.status === 'CONFIRMED').reverse();
      const latest = list[list.length - 1];
      if (latest) await loadSv(latest.stock_voucher_id);
    }
  };

  // Preview of the Number a brand-new voucher will get — stock_voucher_id is assigned the moment
  // Save actually creates the row (draft or posted alike), so this is a client-side preview only.
  const nextSvNoPreview = useMemo(
    () => Math.max(0, ...navVouchers.map(v => v.stock_voucher_id), ...unpostedSvs.map(v => v.stock_voucher_id)) + 1,
    [navVouchers, unpostedSvs]
  );

  // Toolbar's Find — a quick jump to any voucher (posted or unposted) by number or remarks.
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = (v: { remarks: string | null; stock_voucher_id: number }) =>
      (v.remarks || '').toLowerCase().includes(q) || String(v.stock_voucher_id).includes(q);
    const posted = navVouchers.filter(v => v.status === 'CONFIRMED' && matches(v));
    const unposted = unpostedSvs.filter(matches);
    return [
      ...posted.map(v => ({ id: v.stock_voucher_id, remarks: v.remarks, date: v.voucher_date, status: 'posted' as const })),
      ...unposted.map(v => ({ id: v.stock_voucher_id, remarks: v.remarks, date: v.voucher_date, status: 'unposted' as const })),
    ].slice(0, 30);
  }, [findQuery, navVouchers, unpostedSvs]);
  const handleFindSelect = async (id: number) => {
    setIsFindOpen(false);
    setFindQuery('');
    await loadSv(id);
  };

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => { setActiveTab('entry'); handleNew(); }}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'entry' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        New Stock Voucher
      </button>
      <button
        onClick={() => setActiveTab('records')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          activeTab === 'records' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Stock Voucher Ledger
      </button>
      {/* Current Stock / Stock Ledger are their own pages (report-stock, reports#product-ledger)
          — these just jump there, same as clicking them in the top menu (4.STOCK REPORTS), so
          they're reachable from the Stock page itself without needing separate Quick Menu pins. */}
      <button
        onClick={() => dispatch({ type: 'NAVIGATE', page: 'report-stock' })}
        className="px-2 py-1 text-[11px] font-semibold rounded-md transition-all bg-white border text-slate-600 hover:bg-slate-50"
      >
        Current Stock
      </button>
      <button
        onClick={() => dispatch({ type: 'NAVIGATE', page: 'reports', tab: 'product-ledger' })}
        className="px-2 py-1 text-[11px] font-semibold rounded-md transition-all bg-white border text-slate-600 hover:bg-slate-50"
      >
        Stock Ledger
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Stock Voucher" headerAction={tabBar}>
      <div className="mx-auto relative" style={{ maxWidth: 1200 }}>

        {/* Pending Posting — pinned outside the card's own left edge, matching
            JournalVoucherPage/SaleBillPage's sidebar exactly. */}
        {(unpostedSvs.length > 0 || postAllResult) && (
          <aside
            className="hidden 2xl:block absolute top-0 w-64 space-y-3"
            style={{ right: 'calc(100% + 24px)' }}
            data-no-print
          >
            <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-700">Pending Posting</span>
                <span className="text-xs bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
                  {unpostedSvs.length}
                </span>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                {unpostedSvs.length > 0 && `Total ${unpostedSvs.reduce((s, v) => s + Number(v.total_pairs), 0).toLocaleString()} pairs`}
              </div>
              {unpostedSvs.length > 0 && (
                <button
                  type="button"
                  onClick={handlePostAll}
                  disabled={postAllBusy}
                  className="w-full px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {postAllBusy ? 'Posting…' : `Post All (${unpostedSvs.length})`}
                </button>
              )}

              {postAllResult && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <p className="text-xs font-semibold text-slate-700">
                    {postAllResult.posted.length} of {postAllResult.attempted} posted
                    {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                  </p>
                  {postAllResult.failed.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {postAllResult.failed.map(f => (
                        <li key={f.stock_voucher_id} className="text-xs text-rose-700">
                          <span className="font-mono font-semibold">#{f.stock_voucher_id}</span>
                          {' — '}{f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setPostAllResult(null)}
                    className="mt-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {unpostedSvs.length > 0 && (
              <ul className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
                {unpostedSvs.map(v => (
                  <li
                    key={v.stock_voucher_id}
                    onClick={() => handleOpenUnposted(v.stock_voucher_id)}
                    className="px-3 py-2.5 text-xs border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-slate-700">#{v.stock_voucher_id}</div>
                        <div className="text-slate-400 truncate">{v.remarks || '—'}</div>
                        <div className="text-slate-400">{formatDate(v.voucher_date)} · {Number(v.total_pairs).toLocaleString()} pairs</div>
                      </div>
                      <button
                        type="button"
                        title="Post this Stock Voucher"
                        onClick={(e) => handlePostOneUnposted(v.stock_voucher_id, e)}
                        disabled={postingSvId === v.stock_voucher_id}
                        className="flex-shrink-0 p-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <CheckCircle2 size={12} />
                      </button>
                      <button
                        type="button"
                        title="Delete this Stock Voucher (password required)"
                        onClick={(e) => handleDeleteUnposted(v.stock_voucher_id, e)}
                        disabled={postingSvId === v.stock_voucher_id}
                        className="flex-shrink-0 p-1 rounded bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <PasswordPromptModal
          isOpen={isPasswordModalOpen}
          onClose={() => { setIsPasswordModalOpen(false); pendingDeleteSvId.current = null; }}
          onSuccess={handleDeletePasswordSuccess}
          title="Delete Unposted Stock Voucher"
          subtitle="Enter your password to permanently delete this unposted Stock Voucher."
        />

        {/* Find Stock Voucher Modal — jump to any posted or unposted voucher by number or remarks. */}
        {isFindOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
            <div className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
              <h3 className="font-lora font-bold text-lg text-slate-800 mb-4">Find Stock Voucher</h3>
              <input
                type="text"
                value={findQuery}
                onChange={e => setFindQuery(e.target.value)}
                placeholder="Number or remarks..."
                className="soleria-input w-full font-semibold mb-3"
                autoFocus
              />
              <ul className="max-h-72 overflow-y-auto border rounded-lg divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {findResults.map(r => (
                  <li
                    key={`${r.status}-${r.id}`}
                    onClick={() => handleFindSelect(r.id)}
                    className="px-3 py-2 text-xs cursor-pointer hover:bg-amber-50/60 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono font-semibold text-slate-700">#{r.id}</span>
                    <span className="text-slate-400 truncate flex-1">{r.remarks || '—'}</span>
                    <span className="text-slate-400">{formatDate(r.date)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${r.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                  </li>
                ))}
                {findQuery.trim() && findResults.length === 0 && (
                  <li className="px-3 py-3 text-xs text-slate-400 text-center">No matching stock vouchers.</li>
                )}
              </ul>
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={() => { setIsFindOpen(false); setFindQuery(''); }}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 transition-colors text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toasts — fixed to the top-right corner instead of a full-width banner above the
            toolbar (per the user: "the warning message must appear in right not above"). Out of
            document flow, so a validation message popping up no longer pushes the entry card
            down or shrinks the article grid's visible height. */}
        {(lookupError || successMsg || errorMsg) && (
          <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]" data-no-print>
            {lookupError && <div className="banner-error rounded-lg px-4 py-3 text-sm shadow-lg animate-fadeIn">{lookupError}</div>}
            {successMsg && <div className="banner-success rounded-lg px-4 py-3 text-sm shadow-lg animate-fadeIn">{successMsg}</div>}
            {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm shadow-lg animate-fadeIn">{errorMsg}</div>}
          </div>
        )}

        {activeTab === 'entry' && (
        <>
        {/* Toolbar — icon-over-label buttons (`.toolbar-btn`), same set as JournalVoucherPage's
            own: New/Delete/Edit/Done, First/Previous/Next/Last, Print/Find, Un Post/Post. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            <button
              data-new-action="true" ref={newButtonRef} type="button" onClick={handleNew} title="New" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={handleDeleteAction}
              disabled={editingIndex != null ? isViewMode : (mode !== 'view' || svId == null || isPosted)}
              title={editingIndex != null ? 'Delete selected line' : 'Delete'}
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button" onClick={() => setMode('edit')} disabled={!isViewMode || svId == null || isPosted}
              title="Edit"
              className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="submit" form="sv-entry-form" disabled={isViewMode || !isValid}
              title="Done"
              className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button type="button" onClick={handleFirst} disabled={!canBrowse} title="First" className="toolbar-btn">
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button type="button" onClick={handlePrev} disabled={!canNavPrevious} title="Previous" className="toolbar-btn">
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Prev.</span>
            </button>
            <button type="button" onClick={handleNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button type="button" onClick={handleLast} disabled={!canBrowse} title="Last" className="toolbar-btn">
              <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Last</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button"
              onClick={() => window.print()}
              disabled={mode !== 'view' || svId == null}
              title="Print"
              className="toolbar-btn"
            >
              <Printer size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Print</span>
            </button>
            <button type="button" onClick={() => setIsFindOpen(true)} title="Find" className="toolbar-btn">
              <Search size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Find</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button
              type="button" onClick={handleUnpost} disabled={!isViewMode || svId == null || !isPosted || browseFilter !== 'posted'}
              title="Un Post — switch the dropdown to Posted first"
              className="toolbar-btn"
            >
              <Undo2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Un Post</span>
            </button>
            <button
              type="button" onClick={handlePost} disabled={!isViewMode || svId == null || isPosted}
              title="Post"
              className="toolbar-btn"
            >
              <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Post</span>
            </button>
          </div>

          {/* Posted/Unposted — picks which list First/Prev./Next/Last page through. Same row as
              the toolbar icons. Unposted (default) = add/post new vouchers; Posted = browse
              already-posted ones to Un Post one (per the user, 2026-08-30). */}
          <select
            value={browseFilter}
            onChange={e => handleBrowseFilterChange(e.target.value as 'posted' | 'unposted')}
            className="soleria-input soleria-input-compact cursor-pointer font-semibold"
            style={{ width: 'auto' }}
            title="Unposted = add new vouchers. Posted = browse posted vouchers to Un Post one."
            data-no-print
          >
            <option value="unposted">Unposted</option>
            <option value="posted">Posted</option>
          </select>
        </div>

        <form
          id="sv-entry-form" ref={entryCardRef} onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col" style={{ height: entryCardHeight ?? undefined }}
        >
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-4">
            <Boxes size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg tracking-wide text-slate-800">STOCK VOUCHER</h3>
          </div>

          {/* Header — ONE bound-record card. No./Date/To Store on top; On Account (picker, no
              default) and Main A/C (read-only, always mirrors On Account exactly — never a
              separate value, per the user 2026-08-30) each their own row; Remarks last. */}
          <div
            className="shrink-0 grid gap-x-3 gap-y-1.5 mb-2 p-3 rounded-lg border"
            style={{
              background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)',
              gridTemplateColumns: '180px 220px 1fr',
              gridTemplateAreas: `
                "no date store"
                "onacct onacct onacct"
                "mainacct mainacct mainacct"
                "remarks remarks remarks"
              `,
            }}
          >
            <CompactField label="No." gridArea="no">
              <input
                type="text"
                value={svId != null ? `#${svId}` : `#${nextSvNoPreview}`}
                disabled
                className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200 font-mono text-center"
              />
            </CompactField>
            <CompactField label="Date" required gridArea="date">
              <input
                ref={firstFieldRef} type="date" value={date} disabled={isViewMode}
                onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact"
              />
            </CompactField>
            <div className="relative min-w-0" style={{ gridArea: 'store' }}>
              <CompactField label="To >" required>
                <input
                  ref={storeTriggerRef}
                  type="text"
                  disabled={isViewMode}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or Enter to search..."
                  className="soleria-input soleria-input-compact pr-8"
                />
              </CompactField>
              <button
                type="button"
                disabled={isViewMode}
                onClick={openStoreModal}
                title="Browse all stores"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronDown size={14} />
              </button>
              <SearchModal
                isOpen={isStoreModalOpen}
                title="Select Store"
                options={storeOptions}
                value={storeId}
                onSelect={(val) => {
                  setStoreId(val);
                  setIsStoreModalOpen(false);
                  requestAnimationFrame(() => focusNextField(storeTriggerRef.current));
                }}
                onClose={() => setIsStoreModalOpen(false)}
                searchPlaceholder="Search stores..."
                initialSearch={storeModalSeed}
              />
            </div>

            <div className="relative min-w-0" style={{ gridArea: 'onacct' }}>
              <CompactField label="On Account">
                <input
                  ref={accountTriggerRef}
                  type="text"
                  disabled={isViewMode}
                  value={accountSearchText}
                  onChange={e => setAccountSearchText(e.target.value)}
                  onKeyDown={handleAccountTriggerKeyDown}
                  placeholder="Type an account name, or Enter to search..."
                  className="soleria-input soleria-input-compact pr-8"
                />
              </CompactField>
              <button
                type="button"
                disabled={isViewMode}
                onClick={openAccountModal}
                title="Browse all accounts"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronDown size={14} />
              </button>
              <SearchModal
                isOpen={isAccountModalOpen}
                title="Select Account"
                options={accountOptions}
                value={accountBaId}
                onSelect={(val) => {
                  setAccountBaId(val);
                  setIsAccountModalOpen(false);
                  requestAnimationFrame(() => focusNextField(accountTriggerRef.current));
                }}
                onClose={() => setIsAccountModalOpen(false)}
                searchPlaceholder="Search accounts..."
                initialSearch={accountModalSeed}
              />
            </div>

            <CompactField label="Main A/C" gridArea="mainacct">
              <input
                type="text"
                value={selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : '—'}
                disabled
                title="Always the same account selected On Account — not separately changeable"
                className="soleria-input soleria-input-compact bg-gray-100 text-gray-500"
              />
            </CompactField>

            <CompactField label="Remarks" gridArea="remarks">
              <input
                type="text" value={remarks} disabled={isViewMode} onChange={e => setRemarks(e.target.value)}
                placeholder="e.g. Physical count adjustment — optional"
                className="soleria-input soleria-input-compact"
              />
            </CompactField>
          </div>

          {/* Entry strip — Article Code + Product Name + Color on one row, Cartons/Pairs on the
              next. Enter on Cartons (Pairs stays disabled/auto) commits the line into the grid
              below and resets the strip back to Article Code. */}
          {!isViewMode && (
          <div className="shrink-0 mb-2 p-2.5 rounded-lg border" style={{ background: 'rgba(176,141,87,0.06)', borderColor: 'var(--border-color)' }}>
            <div
              className="grid gap-2 mb-2 items-start"
              style={{
                gridTemplateColumns: '190px 1.3fr 130px 150px 90px 90px 140px',
                gridTemplateAreas: '"code name category color cartons pairs stock"',
              }}
            >
              <div className="relative min-w-0" style={{ gridArea: 'code' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Article Code <span className="text-red-500 font-bold">*</span></label>
                <input
                  ref={entryArticleTriggerRef}
                  type="text"
                  value={entry.articleSearchText}
                  onChange={e => setEntry(prev => ({ ...prev, articleSearchText: e.target.value }))}
                  onKeyDown={handleEntryArticleKeyDown}
                  placeholder="Type article code or name..."
                  className="soleria-input pr-8"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  onClick={openEntryArticleModal}
                  title="Browse all articles"
                  className="absolute right-2 bottom-2 p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <ChevronDown size={14} />
                </button>
                <SearchModal
                  isOpen={isEntryArticleModalOpen}
                  title="Select Article"
                  options={products.map(p => ({ value: String(p.article_id), label: `${p.code} — ${p.name}` }))}
                  value={entry.articleId != null ? String(entry.articleId) : ''}
                  initialSearch={entryArticleModalSeed}
                  onSelect={handleEntryArticleSelect}
                  onClose={() => setIsEntryArticleModalOpen(false)}
                  searchPlaceholder="Search articles by code or name..."
                />
              </div>
              <div className="min-w-0" style={{ gridArea: 'name' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
                <input type="text" value={entry.label} disabled placeholder="—" title={entry.label} className="soleria-input bg-gray-100 text-gray-500 truncate" style={{ fontSize: '13px' }} />
              </div>
              <div className="min-w-0" style={{ gridArea: 'category' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <input type="text" value={entry.categoryName} disabled placeholder="—" title={entry.categoryName} className="soleria-input bg-gray-100 text-gray-500 truncate" style={{ fontSize: '13px' }} />
              </div>
              <div className="relative min-w-0" style={{ gridArea: 'color' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Color <span className="text-red-500 font-bold">*</span></label>
                {isAddingColor ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={newColorInputRef}
                      type="text"
                      value={newColorName}
                      onChange={e => setNewColorName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleCreateColor(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setIsAddingColor(false); setNewColorName(''); }
                      }}
                      placeholder="Type new color..."
                      className="soleria-input"
                      style={{ fontSize: '13px' }}
                      disabled={creatingColor}
                    />
                    <button
                      type="button"
                      onClick={handleCreateColor}
                      disabled={creatingColor || !newColorName.trim()}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {creatingColor ? '…' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setIsAddingColor(false); setNewColorName(''); }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      ref={colorTriggerRef}
                      type="text"
                      disabled={isViewMode || entry.articleId == null}
                      value={colorSearchText}
                      onChange={e => setColorSearchText(e.target.value)}
                      onKeyDown={handleColorTriggerKeyDown}
                      placeholder="Color..."
                      className="soleria-input pr-8"
                      style={{ fontSize: '13px' }}
                    />
                    <button
                      type="button"
                      disabled={isViewMode || entry.articleId == null}
                      onClick={openColorModal}
                      title="Browse colors"
                      className="absolute right-2 bottom-2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <SearchModal
                      isOpen={isColorModalOpen}
                      title="Select Color"
                      options={[
                        ...(entry.articleId != null ? variantsByArticle[entry.articleId] || [] : []).map(v => ({ value: String(v.variant_id), label: v.color })),
                        { value: NEW_COLOR_SENTINEL, label: '+ Add New Color...' },
                      ]}
                      value={entry.variantId != null ? String(entry.variantId) : ''}
                      onSelect={(val) => {
                        handleEntryVariantChange(val);
                        setIsColorModalOpen(false);
                        if (val !== NEW_COLOR_SENTINEL) {
                          requestAnimationFrame(() => focusNextField(colorTriggerRef.current));
                        }
                      }}
                      onClose={() => setIsColorModalOpen(false)}
                      searchPlaceholder="Search colors..."
                      initialSearch={colorModalSeed}
                    />
                  </div>
                )}
              </div>
              <div className="min-w-0" style={{ gridArea: 'cartons' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cartons <span className="text-red-500 font-bold">*</span></label>
                <input
                  ref={cartonsInputRef}
                  type="number"
                  value={entry.cartons || ''}
                  min={0}
                  onChange={e => updateEntryCartons(parseInt(e.target.value) || 0)}
                  onKeyDown={handleCartonsKeyDown}
                  className="soleria-input font-mono text-center"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div className="min-w-0" style={{ gridArea: 'pairs' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1">Pairs</label>
                <input type="text" value={entry.pairs || '-'} disabled className="soleria-input bg-gray-100 text-gray-500 font-mono text-center" style={{ fontSize: '13px' }} />
              </div>
              <div className="min-w-0" style={{ gridArea: 'stock' }}>
                <label className="block text-xs font-medium text-slate-600 mb-1 whitespace-nowrap">Stock in Hand</label>
                <input
                  type="text"
                  value={entry.variantId == null ? '—' : stockInHand == null ? '…' : stockInHand.toLocaleString()}
                  disabled
                  className="soleria-input bg-gray-100 text-gray-500 font-mono text-center"
                  style={{ fontSize: '13px' }}
                />
              </div>
            </div>
            {editingIndex != null && (
              <div className="mt-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <span className="text-blue-700 font-semibold">Editing an existing line — commit (Enter on Cartons) to save, or cancel.</span>
                <button type="button" onClick={() => { setEditingIndex(null); setEntry(emptyEntry()); }} className="text-blue-600 hover:text-blue-800 font-semibold underline">
                  Cancel
                </button>
              </div>
            )}
            <div className="mt-2">
              <button type="button" onClick={handleCommitLine} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d]">
                {editingIndex != null ? 'Update Line' : 'Add Line'}
              </button>
            </div>
          </div>
          )}

          {/* Committed lines — read-only grid. Click a row to load it back into the entry strip
              above for editing. No per-row delete — that's the toolbar's own Delete button,
              enabled only while a row is selected. */}
          <div className="flex-1 min-h-0 mb-2 rounded-lg border bg-white overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5 pl-4" style={{ minWidth: '120px' }}>Article Code</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5">Article Description</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5" style={{ minWidth: '120px' }}>Category</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5 text-center" style={{ width: '110px' }}>Cartons</th>
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5 text-right" style={{ width: '110px' }}>Pairs</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr
                    key={line.uid}
                    onClick={() => handleRowClick(idx)}
                    className={`border-b cursor-pointer hover:bg-slate-50/55 transition-colors ${idx === editingIndex ? 'bg-blue-50' : ''}`}
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td className="py-1 px-2 pl-4 font-mono text-xs text-slate-600">{line.articleCode || '—'}</td>
                    <td className="py-1 px-2 text-xs text-slate-800 font-semibold">{line.label || 'N/A'}</td>
                    <td className="py-1 px-2 text-xs text-slate-600">{line.categoryName || '—'}</td>
                    <td className="py-1 px-2 text-center font-mono text-sm text-slate-700">{line.cartons}</td>
                    <td className="py-1 px-2 text-right font-mono text-sm text-slate-700">{line.pairs.toLocaleString()}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-xs text-slate-400">
                      No lines added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Bottom totals row — same small-boxed-fields style as SaleBillPage/JournalVoucherPage. */}
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-3 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Cartons</label>
              <input type="text" value={totals.totalCartons} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-center font-mono font-semibold" style={{ width: '110px' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Pairs</label>
              <input
                type="text"
                value={totals.totalPairs.toLocaleString()}
                disabled
                className="soleria-input soleria-input-compact text-right font-mono font-bold"
                style={{ width: '140px', color: '#ffffff', background: '#111c2a', borderColor: '#334155' }}
              />
            </div>
          </div>
        </form>
        </>
        )}

        {/* Stock Voucher Ledger — own tab, mirrors JV Ledger. */}
        {activeTab === 'records' && (
        <div className="card-white p-6 bg-white border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="font-lora font-semibold text-lg text-slate-800">Stock Voucher Ledger</h3>
            <div className="flex flex-wrap items-center gap-2" data-no-print>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text" value={svSearch} onChange={e => setSvSearch(e.target.value)}
                  placeholder="Search by article, color, remarks..." className="soleria-input pl-8 py-1.5 text-xs w-80"
                />
              </div>
              <select
                value={svStatusFilter}
                onChange={e => setSvStatusFilter(e.target.value as 'all' | 'CONFIRMED' | 'DRAFT')}
                className="soleria-input py-1.5 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="CONFIRMED">Posted</option>
                <option value="DRAFT">Not Posted</option>
              </select>
            </div>
          </div>
          {vouchers.length === 0 ? (
            <div className="text-center p-8 text-slate-400 border border-dashed rounded-xl">
              {svSearch.trim() || svStatusFilter !== 'all' ? 'No stock vouchers match your search/filter.' : 'No stock vouchers recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Number</th>
                    <th className="p-3">Store</th>
                    <th className="p-3">Remarks</th>
                    <th className="p-3 text-center">Lines</th>
                    <th className="p-3 text-right">Total Pairs</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map(v => (
                    <tr key={v.stock_voucher_id} onClick={() => loadRow(v)} className="border-b hover:bg-slate-50/40 cursor-pointer" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-xs text-slate-600">{formatDate(v.voucher_date)}</td>
                      <td className="p-3 text-xs font-mono text-slate-500">#{v.stock_voucher_id}</td>
                      <td className="p-3 text-xs text-slate-500">{v.store_name || '—'}</td>
                      <td className="p-3 text-xs text-slate-500">{v.remarks || '—'}</td>
                      <td className="p-3 text-center text-xs text-slate-500">{v.line_count}</td>
                      <td className="p-3 text-right font-bold font-mono text-slate-800">{Number(v.total_pairs ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${v.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {v.status === 'CONFIRMED' ? 'Posted' : 'Not Posted'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

      </div>
    </AppLayout>
  );
}
