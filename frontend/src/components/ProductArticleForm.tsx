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
  /** Rendered in the first grid slot — used by the single-product edit form for the read-only code field. Omitted in the multi-article add workflow, where the category owns that slot instead. */
  leadingSlot?: ReactNode;
  /** Rendered right after Product Name — used by the single-product edit form's inline category picker. Omitted in the multi-article add workflow, where category is selected once above the whole list. */
  categorySlot?: ReactNode;
  errors?: ArticleFieldErrors;
  /** Wired onto this row's LAST field (the final cost breakdown input) — the multi-article add
   *  workflow uses it for its Shift+Enter/'.'+Enter "add another article" chord, mirroring
   *  SaleBillPage/PurchasePage's item rows. Omitted by the single-product edit form, which has no
   *  such row-adding concept. */
  onLastFieldKeyDown?: (e: React.KeyboardEvent) => void;
  /** Lets a caller focus the Name field programmatically — the multi-article "Add New" workflow
      uses this to return focus to the first card's Name input after a save clears the form, ready
      to type the next article without reaching for the mouse. */
  nameInputRef?: Ref<HTMLInputElement>;
}

/**
 * The product/article detail fields, shared by both the single-product edit form and each card in
 * the multi-article "Add New Article" workflow. Field set and validation intentionally mirror the
 * pre-existing single-product form (products.service.js#validate) — nothing added or removed.
 */
export default function ProductArticleForm({
  values, onChange, vendorList, vendorLocked, vendorLockedLabel, leadingSlot, categorySlot, errors,
  onLastFieldKeyDown, nameInputRef,
}: ProductArticleFormProps) {
  const setCost = (key: CostFieldKey, value: number) =>
    onChange({ costs: { ...values.costs, [key]: value } });

  return (
    <div className="flex flex-col gap-4">
      {/* Basic Details */}
      <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
          <Settings size={15} className="text-[#B08D57]" /> Basic Product Details
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {leadingSlot}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Product Article Name</label>
            <input
              ref={nameInputRef}
              type="text"
              value={values.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="e.g. F-751 Leather Sole"
              className={`soleria-input font-semibold ${errors?.name ? 'border-rose-400' : ''}`}
            />
            {errors?.name && <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">{errors.name}</p>}
          </div>
          {categorySlot}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Color</label>
            <input
              type="text"
              value={values.color}
              onChange={e => onChange({ color: e.target.value })}
              placeholder="e.g. Black, White, Tan"
              className="soleria-input font-semibold"
            />
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
                />
                {errors?.vendorId && <p className="text-[10px] text-rose-600 mt-0.5 font-semibold">{errors.vendorId}</p>}
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Packing (Pairs/Carton)</label>
            <input
              type="number"
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
      <div className="p-4 bg-slate-50 rounded-xl border flex flex-col gap-4" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2">
          <Hammer size={15} className="text-[#B08D57]" /> Production / Manufacturing Cost Breakdown (PKR)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {COST_FIELDS.map((field, idx) => (
            <div key={field.key}>
              <label className="block text-xs text-slate-600 mb-0.5">{field.label}</label>
              <input
                type="number"
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
