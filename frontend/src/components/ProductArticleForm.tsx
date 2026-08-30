import type { ReactNode, Ref } from 'react';
import { Settings, Hammer } from 'lucide-react';
import type { ProductCosts, CostFieldKey } from '@/types';
import { COST_FIELDS } from '@/types';
import SearchableSelect from '@/components/SearchableSelect';
import type { VendorRow } from '@/lib/api';

export interface ArticleFormValues {
  name: string;
  color: string;
  vendorId: string;
  packing: number;
  salePrice: number;
  costs: ProductCosts;
}

export function emptyArticleValues(): ArticleFormValues {
  return {
    name: '',
    color: '',
    vendorId: '',
    packing: 0,
    salePrice: 0,
    costs: Object.fromEntries(COST_FIELDS.map(f => [f.key, 0])) as ProductCosts,
  };
}

export interface ArticleFieldErrors {
  name?: string;
  vendorId?: string;
  packing?: string;
}

interface ProductArticleFormProps {
  values: ArticleFormValues;
  onChange: (patch: Partial<ArticleFormValues>) => void;
  vendorList: VendorRow[];
  vendorLocked?: boolean;
  vendorLockedLabel?: string;
  /** Rendered in the first grid slot — Product Setup's unified form uses this for the read-only Code/Batch No. pair. */
  leadingSlot?: ReactNode;
  /** Rendered right after Product Name — Product Setup's unified form leaves this unused (Category is its own Master row above the whole form instead), but any caller can still slot something in here. */
  categorySlot?: ReactNode;
  errors?: ArticleFieldErrors;
  /** Wired onto this row's LAST field (the final cost breakdown input) — Product Setup's unified
   *  form uses this for plain Enter to commit the record and (in New mode) refocus Product Name,
   *  so a run of new articles can be typed one after another without reaching for the mouse. */
  onLastFieldKeyDown?: (e: React.KeyboardEvent) => void;
  /** Lets a caller focus the Name field programmatically — Product Setup's unified form uses this
      to return focus to Name after New/Done clears the form back to blank. */
  nameInputRef?: Ref<HTMLInputElement>;
  /** The article's full existing color list, rendered as chips above the input, which becomes an
   *  "add another color" field instead of the single free-typed Color box. Every article can carry
   *  more than one color (added here, or later via Stock Voucher's own "+ Add New Color") —
   *  passing this prop is what switches the widget from "one color, overwritten on every edit" to
   *  "see and add to the full list". Omit for a brand-new, not-yet-created article (Product Setup
   *  passes undefined in New mode) — it has no colors yet, so the plain single textbox is correct
   *  there (it seeds the FIRST color at creation time).
   */
  existingColors?: { variant_id: number; color: string }[];
  /** Fires when the user clicks "+ Add" next to the color input — the page owns the actual
   *  resolveOrCreate call and refreshing existingColors afterwards. */
  onAddColor?: () => void;
  /** Fires when the user clicks the × on an existing color chip — the page owns the actual remove
   *  call (soft-delete, per productColors.service.js#remove) and refresh. */
  onRemoveColor?: (variantId: number) => void;
  /** Locks every editable field (Name/Color/+Add/×/Packing/Sale Price/cost breakdown) — Product
   *  Setup's own "view" mode (a loaded record is read-only until the toolbar's Edit button is
   *  pressed), same bound-record convention as Journal Voucher/Stock Voucher. Vendor is unaffected
   *  — it's already always locked via vendorLocked. */
  disabled?: boolean;
}

/**
 * The product/article detail fields — Product Setup's own single unified bound-record form (New/
 * View/Edit via its toolbar). Field set and validation intentionally mirror
 * products.service.js#validate — nothing added or removed.
 */
export default function ProductArticleForm({
  values, onChange, vendorList, vendorLocked, vendorLockedLabel, leadingSlot, categorySlot, errors,
  onLastFieldKeyDown, nameInputRef, existingColors, onAddColor, onRemoveColor, disabled,
}: ProductArticleFormProps) {
  const setCost = (key: CostFieldKey, value: number) =>
    onChange({ costs: { ...values.costs, [key]: value } });

  return (
    <div className="flex flex-col gap-3">
      {/* Basic Details */}
      <div className="p-3 bg-slate-50 rounded-xl border flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-1.5">
          <Settings size={15} className="text-[#B08D57]" /> Basic Product Details
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {leadingSlot}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Product Article Name</label>
            <input
              ref={nameInputRef}
              type="text"
              disabled={disabled}
              value={values.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="e.g. F-751 Leather Sole"
              className={`soleria-input font-semibold ${errors?.name ? 'border-rose-400' : ''}`}
            />
            {errors?.name && <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">{errors.name}</p>}
          </div>
          {categorySlot}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {existingColors ? 'Colors' : 'Color'}
            </label>
            {existingColors && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {existingColors.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No colors added yet</span>
                ) : existingColors.map(c => (
                  <span
                    key={c.variant_id}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
                  >
                    {c.color}
                    {onRemoveColor && !disabled && (
                      <button
                        type="button"
                        onClick={() => onRemoveColor(c.variant_id)}
                        title={`Remove ${c.color}`}
                        className="rounded-full w-4 h-4 flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-rose-100 transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                disabled={disabled}
                value={values.color}
                onChange={e => onChange({ color: e.target.value })}
                onKeyDown={existingColors && onAddColor ? (e => {
                  if (e.key === 'Enter') { e.preventDefault(); onAddColor(); }
                }) : undefined}
                placeholder={existingColors ? 'Type a new color, then + Add...' : 'e.g. Black, White, Tan'}
                className="soleria-input font-semibold flex-1"
              />
              {existingColors && onAddColor && (
                <button
                  type="button"
                  onClick={onAddColor}
                  disabled={disabled || !values.color.trim()}
                  className="px-3 text-xs font-bold rounded-lg bg-[#111c2a] text-[#B08D57] hover:bg-[#1a293d] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  + Add
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor Partner</label>
            {vendorLocked ? (
              <div className="soleria-input bg-slate-100 text-slate-500 font-semibold flex items-center">
                {vendorLockedLabel || '—'}
                <span className="ml-2 text-[10px] text-slate-400 normal-case font-normal">(fixed after creation)</span>
              </div>
            ) : (
              <>
                <SearchableSelect
                  options={[
                    { value: '', label: 'Select Vendor...' },
                    ...vendorList.map(v => ({ value: String(v.vendor_id), label: v.name }))
                  ]}
                  value={values.vendorId}
                  onChange={v => onChange({ vendorId: v })}
                  placeholder="Select Vendor..."
                  disabled={disabled}
                />
                {errors?.vendorId && <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">{errors.vendorId}</p>}
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Packing (Pairs/Carton)</label>
            <input
              type="number"
              disabled={disabled}
              value={values.packing === 0 ? '' : values.packing}
              placeholder="0"
              onChange={e => onChange({ packing: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
              className={`soleria-input font-semibold ${errors?.packing ? 'border-rose-400' : ''}`}
            />
            {errors?.packing && <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">{errors.packing}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Sale Price (Rs)</label>
            <input
              type="number"
              disabled={disabled}
              value={values.salePrice === 0 ? '' : values.salePrice}
              placeholder="0"
              onChange={e => onChange({ salePrice: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
              className="soleria-input font-semibold text-slate-800"
            />
            <p className="text-[10px] text-slate-400 mt-0.5">Used as the default rate when this article is sold</p>
          </div>
        </div>
      </div>

      {/* Manufacturing Breakdown */}
      <div className="p-3 bg-slate-50 rounded-xl border flex flex-col gap-2" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-1.5">
          <Hammer size={15} className="text-[#B08D57]" /> Production / Manufacturing Cost Breakdown (PKR)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {COST_FIELDS.map((field, idx) => (
            <div key={field.key}>
              <label className="block text-xs text-slate-600 mb-0.5">{field.label}</label>
              <input
                type="number"
                disabled={disabled}
                value={values.costs[field.key] === 0 ? '' : values.costs[field.key]}
                placeholder="0"
                onChange={e => setCost(field.key, e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                onKeyDown={idx === COST_FIELDS.length - 1 ? onLastFieldKeyDown : undefined}
                className="soleria-input text-xs font-semibold"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
