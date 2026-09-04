import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import { focusNextField } from '@/lib/fieldNav';
import { usePersistentField, useClearPageDraft, useHasPageDraft } from '@/hooks/usePersistentField';
import * as api from '@/lib/api';
import type {
  ProductRow, ProductVariantRow, StoreRow, StockVoucherRow, StockVoucherLineInput,
  StockVoucherCreateInput, UnpostedStockVoucherRow, PostAllResult, StockRow, BusinessAccountRow,
} from '@/lib/api';
import { formatDate, getTodayDate, toDateInputValue, formatCartons, cartonsProblem, pairsFor, cartonsAndPairs } from '@/lib/utils';
import {
  Edit, Search, Plus, Trash2, Boxes, ChevronDown, CheckCircle2, PackageCheck, Undo2,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Printer
} from 'lucide-react';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import PageToasts from '@/components/PageToasts';
import EditScopeRadios from '@/components/EditScopeRadios';
import { useAutoEditScope } from '@/hooks/useAutoEditScope';
import CartonsInput from '@/components/CartonsInput';

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
 * all removed again as unwanted scope). On Account and Main A/C are both fixed to the seeded
 * STOCK TRANSFER business account, always the same value, never user-editable (per the user,
 * 2026-08-31 — reverses an earlier 2026-08-30 "no default, user-picked" decision).
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

  // Current stock, fetched once for the whole page (not per-article) — feeds both the Article/
  // Color picker modals' per-option "Stock: X ctn / Y prs" sublabel and the entry strip's own
  // Stock in Hand readout, same source and shape as SaleBillPage's own getStockInfo. Reported by
  // the user (2026-08-31): the picker modals showed no stock at all.
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const getStockInfo = useCallback((articleId: number | null, variantId: number | null) => {
    if (!articleId) return null;
    if (variantId != null) {
      const s = stockRows.find(r => r.variant_id === variantId);
      return { cartons: s ? s.cartons : 0, pairs: s ? s.total_pairs : 0 };
    }
    const matching = stockRows.filter(r => r.article_id === articleId);
    return {
      cartons: matching.reduce((sum, r) => sum + r.cartons, 0),
      pairs: matching.reduce((sum, r) => sum + r.total_pairs, 0),
    };
  }, [stockRows]);

  // Cartons/pairs already sitting in OTHER draft (unposted) Stock Vouchers, per variant — nothing
  // here has reached dbo.stock_movements yet (only post() writes those), but the entry strip's
  // Stock in Hand readout treats it as already spoken for anyway, per the user (2026-08-31):
  // "the stock in hand [must] calculate the remaining stock — minus any unposted voucher cartons
  // and the cartons used [in the] current voucher". Refetched whenever the open voucher changes
  // (its own lines move from "another voucher's reservation" to "this voucher's own lines",
  // handled separately below) and after anything that could change who owns what (save/post/
  // unpost/delete elsewhere).
  const [unpostedReservations, setUnpostedReservations] = useState<Record<number, { cartons: number; pairs: number }>>({});
  const refreshUnpostedReservations = useCallback(async (excludeId?: number | null) => {
    const res = await api.stockVouchers.unpostedReservations(excludeId ?? undefined);
    if (res.ok) {
      setUnpostedReservations(Object.fromEntries(res.data.map(r => [r.variant_id, { cartons: r.cartons, pairs: r.pairs }])));
    }
  }, []);

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

  // Tracks whether the two lists nextSvNoPreview (below) reads from have loaded at least once —
  // both start as `[]`, which looks identical to "genuinely empty" and "not fetched yet", so
  // without this the preview would flash "#1" on first paint regardless of the real next number,
  // only correcting once the fetch resolved a beat later. Shows "…" until then instead.
  const [unpostedSvsLoaded, setUnpostedSvsLoaded] = useState(false);
  const refreshUnposted = useCallback(async () => {
    const res = await api.stockVouchers.listUnposted();
    if (res.ok) setUnpostedSvs(res.data);
    setUnpostedSvsLoaded(true);
    return res.ok ? res.data : null;
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
      const [p, st, ba, stock] = await Promise.all([
        api.listProducts(), api.listStores(), api.listBusinessAccounts(), api.reports.stock(),
      ]);
      if (p.ok) setProducts(p.data); else setLookupError('Failed to load products: ' + p.error.message);
      if (st.ok) setStores(st.data); else setLookupError('Failed to load stores: ' + st.error.message);
      if (ba.ok) setBusinessAccounts(ba.data); else setLookupError('Failed to load accounts: ' + ba.error.message);
      if (stock.ok) setStockRows(stock.data); else setLookupError('Failed to load stock: ' + stock.error.message);
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
    refreshUnpostedReservations(svId);
    refreshNav();
    const workingDate = date;
    handleNew();
    setDate(workingDate);
  };

  // Recorded Stock Vouchers moved to its own tab — mirrors JournalVoucherPage/PurchasePage.
  const [activeTab, setActiveTab] = useState<'entry' | 'records'>('entry');

  // ── entry form ──
  //
  // mode/svId/status are persisted alongside the field values, NOT plain useState — see
  // SaleBillPage's own comment for the full reasoning. Short version: leaving them out lost track
  // of WHICH record was on screen after a page switch (no System No.), and the earlier "persist
  // the id and re-fetch on mount" attempt was worse still — it overwrote the user's unsaved edits
  // with the last-saved copy and reopened in 'view' mode, which disables Save.
  const [mode, setMode] = usePersistentField<'new' | 'edit' | 'view'>('stock-voucher', 'mode', 'new');
  const [svId, setSvId] = usePersistentField<number | null>('stock-voucher', 'svId', null);
  const [status, setStatus] = usePersistentField<'CONFIRMED' | 'DRAFT'>('stock-voucher', 'status', 'DRAFT');
  // Refetches whenever the open voucher changes (New/loading a different one) — this voucher's own
  // id is excluded, since its lines are accounted for separately, client-side, from `lines` itself.
  useEffect(() => { refreshUnpostedReservations(svId); }, [svId, refreshUnpostedReservations]);
  // Master/Detail edit-scope radio, per the user 2026-08-31: with a voucher already unlocked via
  // the toolbar's Edit, this further splits WHICH half becomes editable — the header (Master) or
  // the entry strip/grid (Detail), never both at once. Only bites once mode is actually 'edit';
  // pre-picking it doesn't change anything until Edit is clicked.
  // Persisted, not plain useState: mode/svId/status already are, for the exact reason —
  // losing track of state across a page switch. editScope was the one piece left out, so
  // returning to an in-progress 'edit' draft always reset it to 'master', locking the
  // Detail half (entry strip + grid) shut even when that's what had been unlocked and typed
  // into — reported by the user (2026-09-04) as "all the buttons are disable except New".
  const [editScope, setEditScope] = usePersistentField<'master' | 'detail'>('stock-voucher', 'editScope', 'master');
  // Keeps the radios pointing at whichever half is being worked in — see the hook.
  const autoEditScope = useAutoEditScope(setEditScope);
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

  // On Account — pure reference field, fixed to STOCK TRANSFER (see stockTransferAccount below,
  // per the user 2026-08-31). Main A/C is never a separate value, it always mirrors this exactly.
  const [accountBaId, setAccountBaId] = usePersistentField('stock-voucher', 'accountBaId', '');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3500); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 2000); };

  const isViewMode = mode === 'view';
  const isPosted = status === 'CONFIRMED';
  // Derived from editScope — applied to every master/detail field's `disabled` below (2026-08-31).
  const masterLocked = mode === 'edit' && editScope !== 'master';
  const detailLocked = mode === 'edit' && editScope !== 'detail';

  const storeOptions = useMemo(
    () => stores.map(s => ({ value: String(s.store_id), label: s.name })),
    [stores]
  );

  const handleNew = () => {
    setMode('new'); setSvId(null); setStatus('DRAFT');
    setDate(getTodayDate()); setStoreId(''); setRemarks('');
    // Fixed to STOCK TRANSFER, never blank — the auto-populate effect above also covers this once
    // businessAccounts finishes loading, but setting it here too means it's already right the
    // instant New renders if the accounts were already loaded from an earlier fetch this session.
    setAccountBaId(stockTransferAccount ? String(stockTransferAccount.ba_id) : '');
    setLines([]);
    setEntry(emptyEntry());
    setEditingIndex(null);
    setErrorMsg('');
    setEditScope('master');
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
    if (isViewMode || masterLocked) return;
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
      if (isViewMode || masterLocked) return;
      setStoreModalSeed(storeSearchText);
      setIsStoreModalOpen(true);
    }
  }

  // On Account / Main A/C — fixed to the seeded STOCK TRANSFER business account, never user-picked
  // (per the user, 2026-08-31 — reverses the 2026-08-30 "no default, user-editable" decision).
  // Both fields always show and mean the exact same account; neither is ever independently
  // changeable, so there's no picker/SearchModal here any more, just an auto-populated lock.
  const stockTransferAccount = useMemo(
    // The business account's OWN code is its parent chart code + '0001' (db/seeds/run.js
    // #ensureNamedBusinessAccount, e.g. '4000090001'), not the chart code itself — match on
    // ac_code (the parent chart account's code, joined in by businessAccounts.repository.js)
    // instead, same as the reserved-account resolution pattern used server-side.
    () => businessAccounts.find(a => a.ac_code === api.STOCK_TRANSFER_ACCOUNT_CODE),
    [businessAccounts]
  );
  const selectedAccount = stockTransferAccount;
  // Keeps accountBaId (what actually gets saved/sent as on_account_ba_id) pointed at whatever
  // ba_id the STOCK TRANSFER account resolves to, the moment businessAccounts finishes loading —
  // covers both a brand-new voucher and one already loaded from usePersistentField's own restore
  // (which may have an id from before this account existed, or none at all).
  useEffect(() => {
    if (stockTransferAccount && accountBaId !== String(stockTransferAccount.ba_id)) {
      setAccountBaId(String(stockTransferAccount.ba_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockTransferAccount]);

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

  // Stock in Hand — read-only readout in the entry strip (ref-pic parity), derived from the same
  // page-wide `stockRows`/getStockInfo as the Article/Color modals' own sublabels (2026-08-31),
  // rather than a separate per-selection fetch. Store-agnostic, same as the rest of this app's
  // finished-goods stock (stock_movements carries no store_id) — not scoped to the voucher's own
  // Store field. Shows as soon as an ARTICLE is picked — the total across every one of its colors
  // — then narrows to that one color's own count once a color is also picked.
  // Also subtracts what's already spoken for by OTHER draft vouchers (unpostedReservations) and by
  // this SAME voucher's own other committed lines (`lines`, excluding whichever one is being
  // re-edited) — per the user (2026-08-31): "the stock in hand [must] calculate the remaining
  // stock — minus any unposted voucher cartons and the cartons used [in the] current voucher".
  // Clamped at 0 rather than shown negative, same convention as SaleBillPage's own entryStockInHand.
  const stockInHand = useMemo(() => {
    const raw = getStockInfo(entry.articleId, entry.variantId)?.pairs;
    if (raw == null) return null;
    // At article-level (no color picked yet) a variant counts only if it's actually one of THIS
    // article's own colors — stockRows is the only place variant_id -> article_id is known here.
    const matchesTarget = (variantId: number | null) => {
      if (entry.variantId != null) return variantId === entry.variantId;
      return variantId != null && stockRows.some(r => r.variant_id === variantId && r.article_id === entry.articleId);
    };
    const reserved = Object.entries(unpostedReservations)
      .filter(([variantId]) => matchesTarget(Number(variantId)))
      .reduce((sum, [, r]) => sum + r.pairs, 0);
    const usedInThisVoucher = lines.reduce((sum, l, i) => {
      if (i === editingIndex) return sum; // the line being corrected — not a separate reservation
      return matchesTarget(l.variantId) ? sum + l.pairs : sum;
    }, 0);
    return Math.max(0, raw - reserved - usedInThisVoucher);
  }, [entry.articleId, entry.variantId, getStockInfo, unpostedReservations, lines, editingIndex, stockRows]);

  // Shown split into whole cartons + leftover pairs, matching Sale Bill's own readout. A bare
  // number was ambiguous once part cartons became enterable (2026-09-04) — "6" reads as 6 cartons
  // just as easily as the 6 pairs it actually is, which is the exact confusion this whole change
  // is about. Only meaningful once a colour is picked; at article level packing isn't known yet,
  // so the raw pair total is all that can honestly be shown.
  const stockInHandLabel = useMemo(() => {
    if (stockInHand == null) return '';
    if (entry.variantId == null || !(entry.packing > 0)) return `${stockInHand.toLocaleString()} Prs`;
    const split = cartonsAndPairs(stockInHand, entry.packing);
    return `${formatCartons(split.cartons)} Ctn / ${split.pairs} Prs`;
  }, [stockInHand, entry.variantId, entry.packing]);

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
    if (isViewMode || detailLocked || entry.articleId == null) return;
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
      if (isViewMode || detailLocked || entry.articleId == null) return;
      setColorModalSeed(colorSearchText);
      setIsColorModalOpen(true);
    }
  }

  const openEntryArticleModal = () => {
    if (isViewMode || detailLocked) return;
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
      if (isViewMode || detailLocked) return;
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
      articleSearchText: product?.name || '',
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
        pairs: pairsFor(prev.cartons, packing),
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
        pairs: pairsFor(prev.cartons, packing),
      };
    });
    requestAnimationFrame(() => cartonsInputRef.current?.focus());
  };

  const updateEntryCartons = (cartons: number) => {
    setEntry(prev => ({ ...prev, cartons, pairs: pairsFor(cartons, prev.packing) }));
  };

  const handleCommitLine = () => {
    if (entry.articleId == null || entry.variantId == null) {
      fail('Select an article and color before adding the line.');
      return;
    }
    if (entry.cartons <= 0) { fail('Cartons must be greater than 0.'); return; }
    // Mirrors the server's rule (backend/src/utils/cartons.js): cartons is DECIMAL(12,1), so a
    // finer figure would be rounded on save, and pairs stay whole because a pair is indivisible.
    const cartonsIssue = cartonsProblem(entry.cartons, entry.packing);
    if (cartonsIssue) { fail(cartonsIssue); return; }
    if (entry.pairs <= 0) { fail('Pairs must be greater than 0 — check the article\'s packing.'); return; }
    setErrorMsg('');
    const committed: UiLine = {
      uid: editingIndex != null ? lines[editingIndex].uid : newLineUid(),
      articleId: entry.articleId,
      variantId: entry.variantId,
      label: entry.label,
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
    // Cartons must be > 0 before Enter commits — an empty/0 Cartons field used to still commit
    // a line with 0 cartons (reported by the user). A part carton such as 0.5 is fine.
    if (entry.cartons <= 0) { fail('Cartons must be greater than 0.'); return; }
    handleCommitLine();
  }

  // Loads an already-committed line back into the strip for editing (grid row click).
  const loadLineIntoEntry = (idx: number) => {
    const row = lines[idx];
    setEntry({
      articleId: row.articleId, variantId: row.variantId, articleSearchText: row.label,
      label: row.label, categoryName: row.categoryName, packing: row.packing, cartons: row.cartons, pairs: row.pairs,
    });
    setEditingIndex(idx);
    if (row.articleId != null) fetchVariants(row.articleId);
    requestAnimationFrame(() => entryArticleTriggerRef.current?.focus());
  };

  const handleRowClick = (idx: number) => {
    // Detail locked (scope is Master while already editing) — grid rows stay inert, per the
    // Master/Detail edit-scope split (2026-08-31). New/view-mode behavior is untouched.
    if (mode === 'edit' && editScope !== 'detail') return;
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
    refreshUnpostedReservations(svId);
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
    refreshUnpostedReservations(svId);
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
    refreshUnpostedReservations(svId);
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
      label: `${l.article_name || 'Article'} — ${l.color || ''}`,
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
    setEditScope('master');
    setMode('view');
  };

  const loadRow = (row: StockVoucherRow) => { loadSv(row.stock_voucher_id); setActiveTab('entry'); };



  // Password-gated (verified server-side) — deleting a saved-unposted voucher is destructive with
  // no reverse-never-erase trail, same guard level used everywhere else.
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const pendingDeleteSvId = useRef<number | null>(null);


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
    refreshUnpostedReservations(svId);
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

  const [navVouchersLoaded, setNavVouchersLoaded] = useState(false);
  const refreshNav = useCallback(async () => {
    const res = await api.stockVouchers.list({});
    if (res.ok) setNavVouchers(res.data);
    setNavVouchersLoaded(true);
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
      // Re-fetch first, like the Posted branch below — reading the list straight out of state
      // meant one posted or deleted since it was last loaded was still in it, so Unposted
      // opened something that is no longer unposted (2026-09-04).
      const freshUnposted = await refreshUnposted();
      const latest = (freshUnposted ?? unpostedSvs).slice(-1)[0];
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

  // Landing on the page with nothing in progress: the Posted/Unposted dropdown already reads
  // Unposted, so open the newest unposted voucher and park focus on New, exactly as picking
  // Unposted from the dropdown does (per the user, 2026-09-04). Skipped when a draft was
  // restored — that is real in-progress work and must not be overwritten. Runs once; the ref
  // keeps a later state change from re-opening a record over whatever is being typed by then.
  const hasPageDraftAtMount = useHasPageDraft('stock-voucher');
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (hasPageDraftAtMount || didAutoOpenRef.current) return;
    didAutoOpenRef.current = true;
    handleBrowseFilterChange('unposted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="mx-auto relative" style={{ maxWidth: 1200 }} {...autoEditScope}>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Two bare radios parked in the margin just left
            of the toolbar's New button, outside the card: absolute, so the centre card never
            moves, and behind no width gate, so no zoom level can hide them (per the user,
            2026-09-03). */}
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
        {/* Was a hand-rolled fixed panel at top-20 (80px), which tucked under the 144px header
            stack. Same idea, now the shared component so the offset is right and every entry page
            behaves alike. */}
        <PageToasts
          error={lookupError || errorMsg}
          success={successMsg}
          onDismissError={() => { setLookupError(''); setErrorMsg(''); }}
          onDismissSuccess={() => setSuccessMsg('')}
        />

        {activeTab === 'entry' && (
        <>
        {/* Toolbar — icon-over-label buttons (`.toolbar-btn`), same set as JournalVoucherPage's
            own: New/Delete/Edit/Done, First/Previous/Next/Last, Print/Find, Un Post/Post. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 p-2.5 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-0.5">
            <button
              data-new-action="true" ref={newButtonRef} type="button" onClick={handleNew} disabled={browseFilter === 'posted'} title="New" className="toolbar-btn">
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
              type="button"
              // Edit — lands focus on the first field of whichever scope is picked (per the user, 2026-08-31).
              onClick={() => {
                setMode('edit');
                requestAnimationFrame(() => {
                  if (editScope === 'detail') entryArticleTriggerRef.current?.focus();
                  else firstFieldRef.current?.focus();
                });
              }}
              disabled={!isViewMode || svId == null || isPosted}
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
            {/* Post All — moved here when the left-hand Pending Posting panel was removed (per the
                user, 2026-09-03: it overlapped the Master/Detail radios). Same treatment Receipts
                and Sale Bill already had. Reaching one specific unposted voucher is the Unposted
                dropdown plus First/Prev./Next/Last. */}
            {unpostedSvs.length > 0 && (
              <button
                type="button" onClick={handlePostAll} disabled={postAllBusy || browseFilter === 'posted'}
                title={`Post All (${unpostedSvs.length})`}
                className="toolbar-btn"
              >
                <PackageCheck size={20} strokeWidth={2.5} className="text-emerald-600" />
                <span>{postAllBusy ? 'Posting…' : 'Post All'}</span>
              </button>
            )}
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

          {/* Post All's outcome. Was shown inside the left-hand Pending Posting panel; that panel
              is gone (per the user, 2026-09-03), so it lands here under the toolbar instead. A run
              can post 8 of 10, and the two that failed are the whole point — it stays until
              dismissed. */}
          {postAllResult && (
            <div className="w-full mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
              <p className="font-semibold text-slate-700">
                {postAllResult.posted.length} of {postAllResult.attempted} posted
                {postAllResult.failed.length > 0 && ` · ${postAllResult.failed.length} failed`}
                <button type="button" onClick={() => setPostAllResult(null)} className="ml-2 text-slate-500 hover:text-slate-700 font-semibold">Dismiss</button>
              </p>
              {postAllResult.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {postAllResult.failed.map((fail, i) => (
                    <li key={i} className="text-rose-700">{fail.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Master/Detail edit-scope — which half of the document the toolbar's Edit button
            unlocks (per the user, 2026-08-31). Centred directly under the toolbar rather than
            out in the page margin where it used to sit, so it reads as part of the same
            control strip as the Edit button it modifies (per the user, 2026-09-04). */}
        <EditScopeRadios name="sv-edit-scope" value={editScope} onChange={setEditScope} />

        <form
          id="sv-entry-form" ref={entryCardRef} onSubmit={handleSave}
          className="card-white p-6 bg-white border flex flex-col" style={{ height: entryCardHeight ?? undefined }}
          data-edit-scope="detail"
        >
          <div className="shrink-0 flex items-center gap-2 border-b pb-3 mb-4">
            <Boxes size={18} className="text-[#B08D57]" />
            <h3 className="font-lora font-bold text-lg tracking-wide text-slate-800">STOCK VOUCHER</h3>
          </div>

          {/* Header — ONE bound-record card. No./Date/To Store on top; On Account and Main A/C
              (both fixed to STOCK TRANSFER, always the same value, never editable — per the user
              2026-08-31) each their own row; Remarks last. */}
          <div
            className="shrink-0 grid gap-x-3 gap-y-1.5 mb-2 p-3 rounded-lg border"
            data-edit-scope="master"
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
                value={svId != null ? `#${svId}` : (navVouchersLoaded && unpostedSvsLoaded) ? `#${nextSvNoPreview}` : '…'}
                disabled
                className="soleria-input soleria-input-compact bg-gray-50 text-gray-500 border-gray-200 font-mono text-center"
              />
            </CompactField>
            <CompactField label="Date" required gridArea="date">
              <input
                ref={firstFieldRef} type="date" value={date} disabled={isViewMode || masterLocked}
                onChange={e => setDate(e.target.value)} className="soleria-input soleria-input-compact"
              />
            </CompactField>
            <div className="relative min-w-0" style={{ gridArea: 'store' }}>
              <CompactField label="To >" required>
                <input
                  ref={storeTriggerRef}
                  type="text"
                  disabled={isViewMode || masterLocked}
                  value={storeSearchText}
                  onChange={e => setStoreSearchText(e.target.value)}
                  onKeyDown={handleStoreTriggerKeyDown}
                  placeholder="Type a store name, or Enter to search..."
                  className="soleria-input soleria-input-compact pr-8"
                />
              </CompactField>
              <button
                type="button"
                disabled={isViewMode || masterLocked}
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

            <CompactField label="On Account" gridArea="onacct">
              <input
                type="text"
                value={stockTransferAccount ? `${stockTransferAccount.name} (${stockTransferAccount.code})` : '—'}
                disabled
                title="Always STOCK TRANSFER — fixed, not changeable"
                className="soleria-input soleria-input-compact bg-gray-100 text-gray-500"
              />
            </CompactField>

            <CompactField label="Main A/C" gridArea="mainacct">
              <input
                type="text"
                value={selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : '—'}
                disabled
                title="Always the same account as On Account — fixed, not changeable"
                className="soleria-input soleria-input-compact bg-gray-100 text-gray-500"
              />
            </CompactField>

            <CompactField label="Remarks" gridArea="remarks">
              <input
                type="text" value={remarks} disabled={isViewMode || masterLocked} onChange={e => setRemarks(e.target.value)}
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
                  disabled={detailLocked}
                  value={entry.articleSearchText}
                  onChange={e => setEntry(prev => ({ ...prev, articleSearchText: e.target.value }))}
                  onKeyDown={handleEntryArticleKeyDown}
                  placeholder="Type article code or name..."
                  className="soleria-input pr-8"
                  style={{ fontSize: '13px' }}
                />
                <button
                  type="button"
                  disabled={detailLocked}
                  onClick={openEntryArticleModal}
                  title="Browse all articles"
                  className="absolute right-2 bottom-2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronDown size={14} />
                </button>
                <SearchModal
                  isOpen={isEntryArticleModalOpen}
                  title="Select Article"
                  options={products.map(p => {
                    const stock = getStockInfo(p.article_id, null);
                    return {
                      value: String(p.article_id),
                      label: p.name,
                      sublabel: stock ? `Stock: ${formatCartons(stock.cartons)} ctn / ${stock.pairs} prs` : undefined,
                    };
                  })}
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
                      disabled={isViewMode || detailLocked || entry.articleId == null}
                      value={colorSearchText}
                      onChange={e => setColorSearchText(e.target.value)}
                      onKeyDown={handleColorTriggerKeyDown}
                      placeholder="Color..."
                      className="soleria-input pr-8"
                      style={{ fontSize: '13px' }}
                    />
                    <button
                      type="button"
                      disabled={isViewMode || detailLocked || entry.articleId == null}
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
                        ...(entry.articleId != null ? variantsByArticle[entry.articleId] || [] : []).map(v => {
                          const stock = getStockInfo(entry.articleId, v.variant_id);
                          return {
                            value: String(v.variant_id),
                            label: v.color,
                            sublabel: stock ? `Stock: ${formatCartons(stock.cartons)} ctn / ${stock.pairs} prs` : undefined,
                          };
                        }),
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
                {/* One decimal place (per the user, 2026-09-02) — a part carton is real stock, and
                    parseInt('0.5') was silently turning it into 0. */}
                <CartonsInput
                  ref={cartonsInputRef}
                  disabled={detailLocked}
                  value={entry.cartons}
                  min={0}
                  onChange={updateEntryCartons}
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
                  value={entry.articleId == null ? '—' : stockInHand == null ? '…' : stockInHandLabel}
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
              <button type="button" onClick={handleCommitLine} disabled={detailLocked} className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] disabled:opacity-40 disabled:cursor-not-allowed">
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
                  <th className="sticky top-0 z-10 bg-slate-50 p-1.5 pl-4">Article Description</th>
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
                    <td className="py-1 px-2 pl-4 text-xs text-slate-800 font-semibold">{line.label || 'N/A'}</td>
                    <td className="py-1 px-2 text-xs text-slate-600">{line.categoryName || '—'}</td>
                    <td className="py-1 px-2 text-center font-mono text-sm text-slate-700">{formatCartons(line.cartons)}</td>
                    <td className="py-1 px-2 text-right font-mono text-sm text-slate-700">{line.pairs.toLocaleString()}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-3 text-center text-xs text-slate-400">
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
              <input type="text" value={formatCartons(totals.totalCartons)} disabled className="soleria-input soleria-input-compact bg-gray-100 text-gray-700 text-center font-mono font-semibold" style={{ width: '110px' }} />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total Pairs</label>
              <input
                type="text"
                value={totals.totalPairs.toLocaleString()}
                disabled
                className="soleria-input soleria-input-compact text-right font-mono font-bold"
                // Light bar, not the dark navy fill — same fix as Reports Hub/Wage Run/Receipts/
                // Expenses/Sale Bill/Sale Return/Journal Voucher (per the user, 2026-09-03). Text
                // switched from white (which would vanish on a light background) to the app's
                // usual gold accent for "the important total."
                style={{ width: '140px', color: 'var(--brand-gold)', background: '#ffffff', borderColor: 'var(--border-color)' }}
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
