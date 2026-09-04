import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchModal from '@/components/SearchModal';
import { focusNextField } from '@/lib/fieldNav';
import type { ProductCosts, CostFieldKey } from '@/types';
import { COST_FIELDS } from '@/types';
import {
  Plus, Trash2, Edit, Search, RotateCcw, CheckCircle2, ChevronDown,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
} from 'lucide-react';
import DataListTable from '@/components/DataListTable';
import ConfirmModal from '@/components/ConfirmModal';
import PageToasts from '@/components/PageToasts';
import ProductArticleForm, { emptyArticleValues } from '@/components/ProductArticleForm';
import type { ArticleFormValues } from '@/components/ProductArticleForm';
import * as api from '@/lib/api';
import type { ProductRow, CategoryRow, VendorRow, ProductVariantRow, ProductBatchFieldError } from '@/lib/api';
import { usePersistentField, useClearPageDraft } from '@/hooks/usePersistentField';

// Two tabs (per the user, 2026-08-30 follow-up):
//   - Register Product — the bound-record toolbar screen (New/Delete/Edit/Done, First/Prev/Next/
//     Last, Find above a Master Category/Detail article form) — this is where products get
//     created and edited. Enter on the very last detail field (the final cost breakdown box)
//     commits the record and — in New mode — clears back to a blank form with focus back on
//     Product Name, so a run of new articles can be typed one after another without reaching for
//     the mouse. Done always writes straight to the database — no draft/posted status.
//   - Product Detail Info — just the read-only directory of every product currently registered.
//     Click a row to jump to Register Product with that record loaded (view, then Edit to change
//     it).

// The 12 manufacturing-stage cost columns share the same keys on both sides, just cased
// differently — frontend's CostFieldKey is camelCase, the backend's ProductRow/CreateInput is
// snake_case (matches database/schema.sql exactly).
const COST_FIELD_TO_API: Record<CostFieldKey, keyof ProductRow> = {
  cutting: 'cutting', edging: 'edging', upStitch: 'up_stitch', bending: 'bending',
  stubbleDori: 'stubble_dori', shapeForm: 'shape_form', chipkai: 'chipkai', bottom: 'bottom',
  machine: 'machine', trimming: 'trimming', sockStitch: 'sock_stitch', finish: 'finish',
};

function costsFromRow(row: ProductRow): ProductCosts {
  return Object.fromEntries(
    COST_FIELDS.map(f => [f.key, Number(row[COST_FIELD_TO_API[f.key]]) || 0])
  ) as ProductCosts;
}

function costsToApiPayload(costs: ProductCosts) {
  const out: Record<string, number> = {};
  for (const f of COST_FIELDS) out[COST_FIELD_TO_API[f.key]] = costs[f.key];
  return out as {
    cutting: number; edging: number; up_stitch: number; bending: number; stubble_dori: number;
    shape_form: number; chipkai: number; bottom: number; machine: number; trimming: number;
    sock_stitch: number; finish: number;
  };
}

export default function ProductSetupPage() {
  const [productSearch, setProductSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [productList, setProductList] = useState<ProductRow[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryRow[]>([]);
  const [vendorList, setVendorList] = useState<VendorRow[]>([]);
  // Every article belongs to the single system vendor (migration 017) — the business manufactures
  // its own product. The field stays visible so it is clear what a product is attributed to, but it
  // is locked, and products.service.js ignores whatever vendor_id arrives regardless.
  const systemVendor = vendorList.find(v => v.is_system);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    // includeInactive: true — code/batch_no are assigned over EVERY article ever created
    // (products.repository.js#nextCode/#nextBatchNo don't filter on is_active), so previewing
    // them client-side needs the full set; the Directory table below filters back down to
    // active-only itself.
    const [prodRes, catRes, venRes] = await Promise.all([
      api.products.list({ includeInactive: true }),
      api.listCategories(),
      api.listVendors({ includeSystem: true }),
    ]);
    if (prodRes.ok) setProductList(prodRes.data);
    if (catRes.ok) setCategoryList(catRes.data);
    if (venRes.ok) setVendorList(venRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const [pageTab, setPageTab] = useState<'register' | 'directory'>('register');

  // ── Bound-record form state (Register Product tab) ──
  const [mode, setMode] = useState<'new' | 'view' | 'edit'>('new');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [selectedBatchNo, setSelectedBatchNo] = useState<number | null>(null);
  // A New Product's own in-progress fields persist across switching pages AND an app restart
  // (usePersistentField — see src/hooks/usePersistentField.ts). Deliberately NOT applied to
  // selectedProductId/selectedProductName/selectedBatchNo/mode — an already-saved product loaded
  // for view/edit is safely re-openable by id at any time, so caching it risks showing a stale
  // copy instead; only the in-progress "new" form (category + fields; the list below is now real
  // records, saved on Enter)
  // is ever at risk of being lost for good.
  const clearProductSetupDraft = useClearPageDraft('product-setup-register');
  // Master field (per the user: "the master is category, detail is all the product thing").
  const [categoryId, setCategoryId] = usePersistentField('product-setup-register', 'categoryId', '');
  const [formValues, setFormValues] = usePersistentField<ArticleFormValues>('product-setup-register', 'formValues', emptyArticleValues());
  // Every color this article actually has — an article can carry more than one (added here, or via
  // Stock Voucher's own "+ Add New Color"), shown as chips instead of a single overwritten field.
  const [existingColors, setExistingColors] = useState<ProductVariantRow[]>([]);
  const isViewMode = mode === 'view';

  // Tracks the most recently requested article's colors — guards against a slow response for an
  // older selection landing after a newer one, which would otherwise briefly show the wrong
  // product's chips on fast grid clicks / First-Prev-Next-Last browsing.
  const latestColorsRequestRef = useRef<number | null>(null);
  const refreshExistingColors = useCallback(async (articleId: number) => {
    latestColorsRequestRef.current = articleId;
    const res = await api.productColors.listByArticle(articleId);
    if (res.ok && latestColorsRequestRef.current === articleId) {
      setExistingColors(res.data.filter(v => v.is_active));
    }
  }, []);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Category — typable trigger + centered SearchModal popup, same convention as every other
  // lookup in the app (Stock Voucher's Store/On Account fields, etc.) rather than a plain dropdown.
  const categoryTriggerRef = useRef<HTMLInputElement>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categorySearchText, setCategorySearchText] = useState('');
  const [categoryModalSeed, setCategoryModalSeed] = useState('');
  const categoryOptions = useMemo(
    () => categoryList.map(c => ({ value: String(c.category_id), label: c.name })),
    [categoryList]
  );
  useEffect(() => {
    const opt = categoryOptions.find(o => o.value === categoryId);
    setCategorySearchText(opt?.label ?? '');
  }, [categoryId, categoryOptions]);
  const openCategoryModal = () => {
    if (isViewMode) return;
    setCategoryModalSeed('');
    setIsCategoryModalOpen(true);
  };
  function handleCategoryTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openCategoryModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (isViewMode) return;
      setCategoryModalSeed(categorySearchText);
      setIsCategoryModalOpen(true);
    }
  }

  // Staging list (Stock Voucher's own entry-strip/lines-grid pattern, per the user 2026-08-30:
  // Enter adds the current article to this LOCAL list — nothing is written to the database yet.
  // Only the toolbar's Done writes the whole list to the database in one call and moves to a
  // fresh blank screen. All staged articles share the single Category master field above, so
  // Not a pending batch any more — every article is written on Enter. This is kept purely as
  // "what I entered during this sitting", which is what tints those rows green in the list below
  // and what Done reports on.
  const [stagedArticles, setStagedArticles] = usePersistentField<ArticleFormValues[]>('product-setup-register', 'stagedArticles', []);

  // Entering an article now writes it to the database straight away, so the client asked for a
  // confirmation step before it does (2026-09-03: "add it with a confirmation safe dialogue box
  // appears and i press enter it goes"). Enter opens this; Enter again saves — the modal's
  // confirm button is autoFocused, so the second Enter needs no reach for the mouse either.
  const [pendingSave, setPendingSave] = useState<{ name: string; color: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Fills whatever vertical space is left in the viewport below it, same technique as Stock
  // Voucher's own entry card — so the staging list is visible without scrolling the page itself,
  // and only the box's own content scrolls once it overflows that space.
  const stagedBoxRef = useRef<HTMLDivElement>(null);
  const [stagedBoxMaxHeight, setStagedBoxMaxHeight] = useState(240);
  useEffect(() => {
    function recompute() {
      const el = stagedBoxRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setStagedBoxMaxHeight(Math.max(120, window.innerHeight - top - 24));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [mode, isViewMode, categoryId]);

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 3000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 4000); };

  // Toolbar: New — blank article, ready to type.
  //
  // The selected category is deliberately KEPT. The list below the form shows that category's
  // articles, and the working pattern is "pick the category, look at what's there, press New, type
  // the next one" (per the user, 2026-09-03) — clearing it would collapse the very list they just
  // opened, and articles are almost always entered in runs under one category anyway. Focus goes
  // to the article name; the category field is one Shift+Tab away when it does need changing, and
  // New with no category selected still starts there.
  const handleNew = () => {
    setSelectedProductId(null);
    setSelectedProductName('');
    setSelectedBatchNo(null);
    setFormValues(emptyArticleValues());
    setExistingColors([]);
    setMode('new');
    setErrorMsg('');
    setStagedArticles([]);
    clearProductSetupDraft();
    requestAnimationFrame(() => {
      if (categoryId) nameInputRef.current?.focus();
      else categoryTriggerRef.current?.focus();
    });
  };

  // Changing category is free: every article was written to the database the moment it was
  // entered, so there is nothing pending to lose. This used to raise an "articles staged (not yet
  // saved) — changing the category will clear them" confirmation, which stopped being true when
  // entry started saving on Enter and was simply a false alarm by the time the user hit it
  // (2026-09-03). Only the this-sitting marker resets — those articles belong to the category
  // being left, and the list below is about to show a different one.
  const handleCategoryChange = (val: string) => {
    if (val === categoryId) return;
    setCategoryId(val);
    setStagedArticles([]);
    // Whatever is half-typed in the form stays put — re-picking a mistyped category and carrying
    // on is the common case, and the article isn't bound to a category until it is saved.
  };

  // Directory row click / First/Prev/Next/Last — loads a product read-only ("view") and jumps to
  // the Register Product tab, where the bound-record form lives.
  const handleSelectProduct = (prod: ProductRow) => {
    setSelectedProductId(prod.article_id);
    setSelectedProductName(prod.name);
    setSelectedBatchNo(prod.batch_no);
    setCategoryId(String(prod.category_id));
    setFormValues({
      name: prod.name,
      color: '',
      vendorId: String(prod.vendor_id),
      packing: prod.packing || 0,
      salePrice: prod.sale_price || 0,
      costs: costsFromRow(prod),
    });
    setExistingColors([]);
    refreshExistingColors(prod.article_id);
    setMode('view');
    setErrorMsg('');
    setPageTab('register');
  };

  // Toolbar: Edit — unlocks the loaded record's fields.
  const handleEdit = () => { if (mode === 'view') setMode('edit'); };

  // "+ Add" next to the color input — adds ANOTHER color to this article (resolveOrCreate matches
  // an existing one rather than duplicating it), immediately, without waiting for Done.
  const handleAddColor = async () => {
    if (selectedProductId == null || !formValues.color.trim()) return;
    const res = await api.productColors.resolveOrCreate({
      article_id: selectedProductId, color: formValues.color.trim(), packing: formValues.packing,
    });
    if (!res.ok) return fail(res.error.message);
    setFormValues(prev => ({ ...prev, color: '' }));
    await refreshExistingColors(selectedProductId);
    flash(`Color "${res.data.color}" added.`);
  };

  // × on a chip — soft-deletes that color (productColors.service.js#remove sets is_active=0);
  // historical stock_movements/sale_bill_items rows referencing it are untouched.
  const handleRemoveColor = async (variantId: number) => {
    const res = await api.productColors.remove(variantId);
    if (!res.ok) return fail(res.error.message);
    if (selectedProductId != null) await refreshExistingColors(selectedProductId);
  };

  const [reactivatePrompt, setReactivatePrompt] = useState<{ article_id: number; name: string } | null>(null);

  // Validates the current form and returns it as a stageable snapshot, or null (with an error
  // banner already shown) if it isn't ready yet.
  function buildStagedEntry(): ArticleFormValues | null {
    const typedName = formValues.name.trim();
    if (!typedName) { fail('Product Article Name is required.'); return null; }
    if (!categoryId) { fail('Category is required. Please select a category.'); return null; }
    if (!formValues.packing || formValues.packing <= 0) { fail('Packing (pairs/carton) must be greater than 0.'); return null; }
    return { ...formValues, name: typedName };
  }

  // Enter on the last detail field — SAVES the article to the database there and then (per the
  // user, 2026-09-02: "if we enter a product then it will be saved in db/record without pressing
  // done/post"). It used to stage into a local list and write nothing until Done, so closing the
  // app with articles typed lost all of them.
  //
  // The list below the form is therefore a list of REAL records now, not a pending batch. Each row
  // carries its articleId, so re-opening one and pressing Enter updates that record instead of
  // creating a second one.
  //
  // Saved one at a time rather than accumulating a batch: the point is that each article is safe
  // the moment it is entered, and a per-article call is also what lets a duplicate or a validation
  // failure name the article it belongs to instead of failing the whole batch at the end.
  const handleStageCurrent = async () => {
    const entry = buildStagedEntry();
    if (!entry) return;

    let savedId: number | undefined;

    {
      const res = await api.products.createBatch({
        category_id: Number(categoryId),
        articles: [{
          name: entry.name,
          vendor_id: systemVendor?.vendor_id ?? 0,
          packing: entry.packing,
          sale_price: entry.salePrice,
          ...costsToApiPayload(entry.costs),
        }],
      });
      if (!res.ok) {
        const details = res.error.details as { article_id?: number; name?: string; errors?: ProductBatchFieldError[] } | undefined;
        if (res.error.code === 'BATCH_VALIDATION_FAILED' && details?.errors) {
          return fail('Please fix: ' + details.errors.map(e => e.message).join('; '));
        }
        // An inactive article of the same name already exists — offer to bring it back rather than
        // refusing. The form keeps what was typed so the prompt can be answered either way.
        if (res.error.code === 'INACTIVE_DUPLICATE' && details?.article_id != null && details?.name) {
          setReactivatePrompt({ article_id: details.article_id, name: details.name });
          return;
        }
        // The article already exists and is active. Entering the same name again is how the
        // operator adds ANOTHER COLOUR to it — the same article comes in several colours — so
        // treat it as that rather than refusing, provided a colour was actually typed.
        // resolveOrCreate matches an existing colour instead of duplicating it, so re-entering a
        // colour that is already there is harmless.
        if (res.error.code === 'DUPLICATE_NAME' && details?.article_id != null) {
          if (!entry.color.trim()) {
            return fail(`"${entry.name}" already exists. Add a colour to register another colour of it, `
              + 'or open it from the Directory to change its details.');
          }
          const colorRes = await api.productColors.resolveOrCreate({
            article_id: details.article_id, color: entry.color.trim(), packing: entry.packing,
          });
          if (!colorRes.ok) return fail(colorRes.error.message);
          setStagedArticles(prev => [...prev, { ...entry, articleId: details.article_id }]);
          setFormValues(emptyArticleValues());
          setErrorMsg('');
          flash(`"${entry.color.trim()}" added to the existing article "${entry.name}".`);
          loadAll();
          requestAnimationFrame(() => nameInputRef.current?.focus());
          return;
        }
        return fail(res.error.message);
      }
      savedId = res.data[0]?.article_id;
    }

    // Colour is optional and lives on its own table; resolveOrCreate matches an existing colour
    // rather than duplicating it.
    if (savedId != null && entry.color.trim()) {
      await api.productColors.resolveOrCreate({
        article_id: savedId, color: entry.color.trim(), packing: entry.packing,
      });
    }

    setStagedArticles(prev => [...prev, { ...entry, articleId: savedId }]);
    setFormValues(emptyArticleValues());
    setErrorMsg('');
    flash(`"${entry.name}" saved.`);
    loadAll(); // the Directory should show it immediately — it is a real record now
    requestAnimationFrame(() => nameInputRef.current?.focus());
    // category stays selected — the operator is usually entering several under one category
  };

  function handleLastFieldEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    if (mode !== 'new') return;
    // Validate BEFORE asking: a confirmation box for an entry that cannot be saved is just an
    // extra keypress in front of the same error. buildStagedEntry surfaces the reason itself.
    const entry = buildStagedEntry();
    if (!entry) return;
    setPendingSave({ name: entry.name, color: entry.color.trim() });
  }

  const confirmPendingSave = async () => {
    setSaving(true);
    try {
      await handleStageCurrent();
    } finally {
      setSaving(false);
      setPendingSave(null);
    }
  };

  // Toolbar: Done — New mode writes the WHOLE staged list to the database in one call (staging
  // whatever's currently typed first, if anything), then resets to a fresh blank screen, per the
  // user (2026-08-30): "when I press done then it will add and move to the new screen". Edit mode
  // (a saved record loaded from the Directory) saves that one record directly, unchanged from
  // before. No draft/posted status either way.
  const handleDone = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (mode === 'view') return;

    if (mode === 'edit' && selectedProductId != null) {
      const typedName = formValues.name.trim();
      if (!typedName) return fail('Product Article Name is required.');
      if (!categoryId) return fail('Category is required. Please select a category.');
      if (!formValues.packing || formValues.packing <= 0) return fail('Packing (pairs/carton) must be greater than 0.');
      const res = await api.products.update(selectedProductId, {
        name: typedName, category_id: Number(categoryId), packing: formValues.packing,
        sale_price: formValues.salePrice, ...costsToApiPayload(formValues.costs),
      });
      if (!res.ok) return fail(res.error.message);
      if (formValues.color.trim()) {
        await api.productColors.resolveOrCreate({ article_id: selectedProductId, color: formValues.color.trim(), packing: formValues.packing });
        setFormValues(prev => ({ ...prev, color: '' }));
        await refreshExistingColors(selectedProductId);
      }
      flash('Product details updated successfully.');
      loadAll();
      setErrorMsg('');
      setMode('view');
      return;
    }

    // mode === 'new' — everything in the list below is ALREADY in the database (saved on Enter,
    // see handleStageCurrent). Done therefore commits only what is still sitting unsaved in the
    // form, then clears for the next product. It must not re-submit the list, or every article
    // would be created a second time.
    const hasUnsavedContent = formValues.name.trim() || formValues.packing > 0 || formValues.salePrice > 0
      || Object.values(formValues.costs).some(v => v > 0);
    if (hasUnsavedContent) {
      await handleStageCurrent(); // saves it, or shows why it can't be saved
      // If it failed, the form still holds it and the banner says why — don't clear over the top.
      if (formValues.name.trim()) return;
    } else if (stagedArticles.length === 0) {
      return fail('Enter a product first — it saves as soon as you press Enter.');
    }

    flash('Finished. Ready for the next product.');
    loadAll();
    handleNew(); // full reset — "move to the new screen"
  };

  const confirmReactivateFromPrompt = async () => {
    if (!reactivatePrompt) return;
    const res = await api.products.reactivate(reactivatePrompt.article_id);
    setReactivatePrompt(null);
    if (!res.ok) return fail('Failed to reactivate: ' + res.error.message);
    flash('Existing product reactivated.');
    loadAll();
    // Stay on the form — the rest of the staged batch is preserved so the user can remove the
    // colliding one and press Done again.
  };

  // Toolbar: Delete — dual-purpose by context, same convention as Stock Voucher/Journal Voucher.
  //
  // A row in the New-mode list is a REAL record now (saved on Enter), so deleting one has to go to
  // the database. Dropping it from the local list alone — which is what this did while the list
  // was a pending batch — would leave the article behind in the Directory while appearing to
  // remove it.
  const [deletingProduct, setDeletingProduct] = useState<{ article_id: number; name: string } | null>(null);
  const handleDeleteAction = () => {
    if (selectedProductId == null) return;
    setDeletingProduct({ article_id: selectedProductId, name: formValues.name });
  };
  const confirmDelete = async () => {
    if (!deletingProduct) return;
    const res = await api.products.remove(deletingProduct.article_id);
    const deletedId = deletingProduct.article_id;
    setDeletingProduct(null);
    if (!res.ok) return fail('Failed to delete: ' + res.error.message);
    flash('Product deleted successfully.');
    // Drop just that row from the session list rather than calling handleNew(), which clears the
    // whole list — the other articles entered in this sitting are still real records and the
    // operator should keep seeing them.
    setStagedArticles(prev => prev.filter(a => a.articleId !== deletedId));
    setSelectedProductId(null);
    setFormValues(emptyArticleValues());
    setMode('new');
    loadAll();
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  // Everything already registered under the category the operator has selected. The client's own
  // Product Detail Info screen lists these in the space below the form the moment a category is
  // picked (2026-09-03: "when i select a category it shows me all the product under that category
  // in space below"), so entering a run of articles never needs a trip to another tab to see what
  // is already there.
  const categoryProducts = useMemo(() => {
    if (!categoryId) return [];
    return productList
      .filter(p => p.is_active && String(p.category_id) === String(categoryId))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [productList, categoryId]);

  // article_ids entered during this sitting — flagged in the list so a long-established category
  // still makes clear which rows are the operator's own work just now.
  const savedThisSitting = useMemo(
    () => new Set(stagedArticles.map(a => a.articleId).filter((id): id is number => id != null)),
    [stagedArticles]
  );

  const totalCostOf = (prod: ProductRow) =>
    COST_FIELDS.reduce((sum, f) => sum + (Number(prod[COST_FIELD_TO_API[f.key]]) || 0), 0);

  const filteredProducts = useMemo(() => {
    const active = productList.filter(p => p.is_active);
    if (!productSearch.trim()) return active;
    const q = productSearch.toLowerCase();
    return active.filter(prod =>
      prod.name.toLowerCase().includes(q) ||
      (prod.category_name || '').toLowerCase().includes(q) ||
      (prod.vendor_name || '').toLowerCase().includes(q)
    );
  }, [productList, productSearch]);

  // Preview of the Batch No. a brand-new article will get — nextBatchNo() is transaction-scoped
  // server-side, so this is a client-side approximation only (real value is assigned at Save);
  // mirrors Stock Voucher/Sale Bill's own "Number" preview pattern.
  const nextBatchNoPreview = useMemo(
    () => Math.max(0, ...productList.map(p => p.batch_no || 0)) + 1,
    [productList]
  );

  // Toolbar: First/Prev/Next/Last — walk the (possibly search-filtered) directory list.
  const navIndex = useMemo(() => {
    if (selectedProductId == null) return -1;
    return filteredProducts.findIndex(p => p.article_id === selectedProductId);
  }, [selectedProductId, filteredProducts]);
  const canNavigate = filteredProducts.length > 0;
  // navIndex === -1 means the loaded record has been filtered out of the current (searched) list
  // — there's no well-defined "previous/next" relative to it, so both are disabled rather than
  // both silently jumping to index 0.
  const canNavPrev = canNavigate && navIndex > 0;
  const canNavNext = canNavigate && navIndex !== -1 && navIndex !== filteredProducts.length - 1;
  const handleFirst = () => filteredProducts[0] && handleSelectProduct(filteredProducts[0]);
  const handleLast = () => filteredProducts.length > 0 && handleSelectProduct(filteredProducts[filteredProducts.length - 1]);
  const handlePrev = () => {
    const i = navIndex <= 0 ? 0 : navIndex - 1;
    if (filteredProducts[i]) handleSelectProduct(filteredProducts[i]);
  };
  const handleNext = () => {
    const i = navIndex === -1 ? 0 : Math.min(navIndex + 1, filteredProducts.length - 1);
    if (filteredProducts[i]) handleSelectProduct(filteredProducts[i]);
  };

  // Toolbar: Find — jump to the Product Detail Info directory and focus its search box.
  const handleFind = () => {
    setPageTab('directory');
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const tabBar = (
    <div className="flex gap-1.5" data-no-print>
      <button
        onClick={() => setPageTab('register')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          pageTab === 'register' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Register Product
      </button>
      <button
        onClick={() => setPageTab('directory')}
        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
          pageTab === 'directory' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'bg-white border text-slate-600 hover:bg-slate-50'
        }`}
      >
        Product Detail Info
      </button>
    </div>
  );

  return (
    <AppLayout pageTitle="Product Setup" headerAction={tabBar}>
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Feedback goes to the right-hand gutter rather than above the toolbar — an inline
            banner here pushed the whole card (and the toolbar buttons) down mid-click, which is
            the same problem PageToasts was introduced to fix on the voucher pages. */}
        <PageToasts
          success={successMsg}
          error={errorMsg}
          onDismissSuccess={() => setSuccessMsg('')}
          onDismissError={() => setErrorMsg('')}
        />

        {pageTab === 'register' && (
        <>
        {/* Toolbar — icon-over-label buttons, same set/style as Journal Voucher/Stock Voucher's
            own: New/Delete/Edit/Done, First/Previous/Next/Last, Find. No Post/Unpost — a product
            master record has no draft/posted concept to toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2 rounded-xl border" style={{ background: '#ffffff', borderColor: 'var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-0.5">
            <button
              data-new-action="true" type="button" onClick={handleNew} title="New" className="toolbar-btn">
              <Plus size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>New</span>
            </button>
            <button
              type="button" onClick={handleDeleteAction}
              disabled={selectedProductId == null}
              title="Delete" 
              className="toolbar-btn"
            >
              <Trash2 size={20} strokeWidth={2.5} className="text-rose-600" />
              <span>Delete</span>
            </button>
            <button
              type="button" onClick={handleEdit} disabled={mode !== 'view'}
              title="Edit" className="toolbar-btn"
            >
              <Edit size={20} strokeWidth={2.5} className="text-sky-600" />
              <span>Edit</span>
            </button>
            <button
              type="button" onClick={() => handleDone()} disabled={isViewMode}
              title="Done" className="toolbar-btn"
            >
              <CheckCircle2 size={20} strokeWidth={2.5} className="text-emerald-600" />
              <span>Done</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button type="button" onClick={handleFirst} disabled={!canNavigate} title="First" className="toolbar-btn">
              <ChevronsLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>First</span>
            </button>
            <button type="button" onClick={handlePrev} disabled={!canNavPrev} title="Previous" className="toolbar-btn">
              <ChevronLeft size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Prev.</span>
            </button>
            <button type="button" onClick={handleNext} disabled={!canNavNext} title="Next" className="toolbar-btn">
              <ChevronRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Next</span>
            </button>
            <button type="button" onClick={handleLast} disabled={!canNavigate} title="Last" className="toolbar-btn">
              <ChevronsRight size={20} strokeWidth={2.5} className="text-amber-600" />
              <span>Last</span>
            </button>

            <span className="w-px self-stretch mx-1" style={{ background: 'var(--border-color)' }} />

            <button type="button" onClick={handleFind} title="Find" className="toolbar-btn">
              <Search size={20} strokeWidth={2.5} className="text-slate-600" />
              <span>Find</span>
            </button>
          </div>
          <span className="font-lora font-bold text-xs text-slate-900">
            {mode === 'edit' ? `Editing ${selectedProductName}`
              : mode === 'view' ? selectedProductName
              : stagedArticles.length > 0 ? `New Product — ${stagedArticles.length} saved`
              : 'New Product'}
          </span>
        </div>

        <form id="product-detail-form" onSubmit={handleDone} className="card-white p-2 bg-white border flex flex-col gap-2">
          {/* Master — Category, per the user: "the master is category, detail is all the product
              thing". Typable trigger + centered SearchModal popup, same as every other lookup in
              the app (per the user, 2026-08-30: "category must be modal pop up"). */}
          <div className="px-2 py-1.5 rounded-lg border-2 flex items-center gap-2" style={{ borderColor: 'var(--brand-gold)', background: 'linear-gradient(180deg, #fbf7f0 0%, #ffffff 100%)' }}>
            <label className="shrink-0 text-[10px] font-bold text-slate-700 uppercase tracking-wider">
              Select Category <span className="text-red-500 font-bold">*</span>
            </label>
            <div className="flex-1 relative">
              <input
                ref={categoryTriggerRef}
                type="text"
                disabled={isViewMode}
                value={categorySearchText}
                onChange={e => setCategorySearchText(e.target.value)}
                onKeyDown={handleCategoryTriggerKeyDown}
                placeholder="Type a category name, or press Enter to search..."
                className="soleria-input soleria-input-compact pr-8"
              />
              <button
                type="button"
                disabled={isViewMode}
                onClick={openCategoryModal}
                title="Browse all categories"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronDown size={14} />
              </button>
              <SearchModal
                isOpen={isCategoryModalOpen}
                title="Select Category"
                options={categoryOptions}
                value={categoryId}
                onSelect={(val) => {
                  handleCategoryChange(val);
                  setIsCategoryModalOpen(false);
                  requestAnimationFrame(() => focusNextField(categoryTriggerRef.current));
                }}
                onClose={() => setIsCategoryModalOpen(false)}
                searchPlaceholder="Search categories..."
                initialSearch={categoryModalSeed}
              />
            </div>
          </div>

          {/* Detail — everything about the article itself. */}
          <ProductArticleForm
            values={formValues}
            onChange={patch => setFormValues(prev => ({ ...prev, ...patch }))}
            vendorList={vendorList}
            vendorLocked
            vendorLockedLabel={systemVendor?.name || 'Manufacturing Product'}
            disabled={isViewMode}
            existingColors={mode === 'new' ? undefined : existingColors}
            onAddColor={mode === 'new' ? undefined : handleAddColor}
            onRemoveColor={mode === 'new' ? undefined : handleRemoveColor}
            onLastFieldKeyDown={!isViewMode ? handleLastFieldEnter : undefined}
            nameInputRef={nameInputRef}
            leadingSlot={
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Batch No.</label>
                  <input
                    type="text"
                    value={selectedBatchNo ?? (mode === 'new' ? `${nextBatchNoPreview} (pending)` : '(auto)')}
                    disabled
                    className="soleria-input soleria-input-compact font-semibold bg-slate-100 text-slate-500 cursor-not-allowed"
                  />
                </div>
              </div>
            }
          />
        </form>

        {/* Every article already registered under the selected category, in the space below the
            form — the client's own Product Detail Info screen works this way (2026-09-03). Rows
            are deliberately tight: the reference screen shows 10-15 articles at once, so this one
            does too. Click a row to load it into the form above. */}
        {categoryId && (
          <div className="card-white bg-white border mt-3 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="font-lora font-semibold text-xs text-slate-800">
                {categorySearchText || 'Category'} — {categoryProducts.length} article{categoryProducts.length === 1 ? '' : 's'}
              </h3>
              <span className="text-[10px] text-slate-500 font-medium">Click a row to open it</span>
            </div>
            <div
              ref={stagedBoxRef}
              className="rounded-lg border bg-white overflow-y-auto"
              style={{ borderColor: 'var(--border-color)', maxHeight: stagedBoxMaxHeight }}
            >
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b text-[10px] font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="sticky top-0 z-10 bg-slate-50 py-1 px-2 pl-3">Name</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-1 px-2 text-center" style={{ width: '72px' }}>Batch</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-1 px-2 text-center" style={{ width: '80px' }}>Packing</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-1 px-2 text-right" style={{ width: '110px' }}>Cost</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-1 px-2 text-right" style={{ width: '110px' }}>Sale Price</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryProducts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                        No articles registered under this category yet.
                      </td>
                    </tr>
                  ) : categoryProducts.map(prod => (
                    <tr
                      key={prod.article_id}
                      onClick={() => handleSelectProduct(prod)}
                      className={`border-b cursor-pointer hover:bg-slate-50/70 transition-colors ${
                        prod.article_id === selectedProductId ? 'bg-blue-50'
                          : savedThisSitting.has(prod.article_id) ? 'bg-emerald-50/60' : ''
                      }`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="py-0.5 px-2 pl-3 text-[11px] font-semibold text-slate-900">{prod.name}</td>
                      <td className="py-0.5 px-2 text-center font-mono text-[11px] text-slate-600">{prod.batch_no}</td>
                      <td className="py-0.5 px-2 text-center font-mono text-[11px] text-slate-700">{prod.packing}</td>
                      <td className="py-0.5 px-2 text-right font-mono text-[11px] text-slate-600">{formatCurrency(totalCostOf(prod))}</td>
                      <td className="py-0.5 px-2 text-right font-mono text-[11px] font-bold text-amber-800">{formatCurrency(prod.sale_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
        )}

        {pageTab === 'directory' && (
          /* Product Detail Info — just the current products, per the user (2026-08-30): "product
             detail only show me the current products that I have". Click a row to open it on the
             Register Product tab (view, then Edit to change it). */
          <div className="card-white p-3 bg-white border">
            <div className="border-b pb-2 mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-lora font-semibold text-sm text-slate-800">
                  Registered Products <span className="text-slate-400 font-normal">({filteredProducts.length})</span>
                </h3>
                <p className="text-[10px] text-slate-500 font-medium">Click a row to open it on Register Product.</p>
              </div>
              <div className="relative min-w-[280px]">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search by article, category..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="soleria-input w-full py-1.5 text-xs pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2 text-slate-400" size={14} />
              </div>
            </div>

            <DataListTable<ProductRow>
              dense
              rows={filteredProducts}
              rowKey={prod => prod.article_id}
              onRowClick={prod => handleSelectProduct(prod)}
              loading={loading}
              emptyMessage="No registered products found."
              columns={[
                {
                  key: 'name',
                  header: 'Article Name',
                  render: prod => <span className="font-semibold text-slate-900">{prod.name}</span>,
                },
                {
                  key: 'category',
                  header: 'Category',
                  render: prod => (
                    <span className="text-slate-500 font-medium">{prod.category_name || 'General'}</span>
                  ),
                },
                {
                  key: 'vendor',
                  header: 'Vendor',
                  render: prod => (
                    <span className="text-slate-600 font-semibold">{prod.vendor_name || 'N/A'}</span>
                  ),
                },
                {
                  key: 'packing',
                  header: 'Packing (Pairs)',
                  align: 'center',
                  render: prod => <span className="font-semibold text-slate-700">{prod.packing}</span>,
                },
                {
                  key: 'sale_price',
                  header: 'Sale Price',
                  align: 'right',
                  render: prod => (
                    <span className="font-bold text-amber-800">{formatCurrency(prod.sale_price)}</span>
                  ),
                },
              ]}
            />
          </div>
        )}

        {/* Confirm before writing a new article. Enter opens it from the last cost field and
            Enter again commits, so a run of articles is still pure keyboard. */}
        <ConfirmModal
          isOpen={pendingSave !== null}
          title="Save this article?"
          confirmLabel="Save"
          busy={saving}
          body={
            <>
              Register <strong>{pendingSave?.name}</strong>
              {pendingSave?.color ? <> in <strong>{pendingSave.color}</strong></> : null} under{' '}
              <strong>{categorySearchText || 'the selected category'}</strong>? Press Enter to confirm.
            </>
          }
          onConfirm={confirmPendingSave}
          onCancel={() => setPendingSave(null)}
        />

        {/* Reactivate-inactive-duplicate prompt */}
        {reactivatePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setReactivatePrompt(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setReactivatePrompt(null))(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-amber-400 shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2 flex items-center gap-2">
                <RotateCcw size={18} className="text-amber-500" /> Inactive Product Found
              </h3>
              <p className="text-xs text-slate-600 mb-4">
                An inactive product named <strong>{reactivatePrompt.name}</strong> for this vendor
                already exists. Reactivate it instead of creating a new record?
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setReactivatePrompt(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmReactivateFromPrompt} className="btn-gold px-4 py-2 text-xs font-semibold cursor-pointer">Reactivate</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {deletingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs" onClick={() => setDeletingProduct(null)}
            onKeyDown={e => { if (e.key === 'Escape') { (() => setDeletingProduct(null))(); } }}
            tabIndex={-1}>
            <div className="bg-white rounded-2xl border-2 border-rose-400 shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="font-lora font-bold text-base text-slate-900 mb-2">Delete Product</h3>
              <p className="text-xs text-slate-600 mb-4">
                Delete <strong>{deletingProduct.name}</strong>? This deactivates the record — past
                sale/purchase/production history is kept intact.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeletingProduct(null)} className="btn-outline px-4 py-2 text-xs font-semibold cursor-pointer">Cancel</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-xs font-semibold cursor-pointer rounded-lg bg-rose-600 text-white hover:bg-rose-700">Delete</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
