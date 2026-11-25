import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import SearchModal, { unchangedPick, type SearchModalOption } from '@/components/SearchModal';
import wentoxLogo from '@/assets/wentox_logo.png';
import { formatDate, formatDateTime } from '@/lib/utils';
import type { SaleDetailRow } from '@/lib/api';

// Shared by the Customer Sales and Article Sales reports so both documents have the SAME ten
// columns at the SAME widths — every row, subtotal and total lines up in both, on screen and on
// paper. (Client request, 2026-11-23: "make sure everything is in line".)

export const OUT_COLOR = '#e11d48';
const TEXT = '#111111';

export const TH: CSSProperties = { border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' };
export const TH_R: CSSProperties = { ...TH, textAlign: 'right' };
export const TD: CSSProperties = { border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', overflowWrap: 'anywhere' };
export const TD_R: CSSProperties = { ...TD, textAlign: 'right', fontFamily: 'monospace' };
export const TD_NUM: CSSProperties = { ...TD_R, fontWeight: 'bold' };
export const TOTAL_TD: CSSProperties = { ...TH, fontSize: '11px' };
export const TOTAL_TD_R: CSSProperties = { ...TOTAL_TD, textAlign: 'right', fontFamily: 'monospace' };

// Column widths (percent, sum 100): Date, Type, Bill No., Customer/Article, Color, Cartons, Pairs,
// Rate, Disc %, Value. They sit on the header cells of a fixed-layout table (not a <colgroup>): the
// print preview rebuilds each page's table from a clone of the <thead> only, so widths carried by
// the header cells survive page splitting and every page keeps identical columns.
const WIDTHS = [9, 7, 10, 22, 9, 8, 8, 9, 6, 12];
/** Columns before the first figure (Date … Color) — a total row's label spans exactly these. */
export const LABEL_COLUMNS = 5;

export const TABLE_STYLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', marginBottom: '15px', tableLayout: 'fixed' };

// ── Figures: negatives in brackets and red, zero as a dash (the convention of the other reports).
const sign = (n: number, text: string) => (n < 0 ? `(${text})` : text);
export const fmtCartons = (n: number) => {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '-';
  return sign(r, Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: 1 }));
};
export const fmtPairs = (n: number) => (n === 0 ? '-' : sign(n, Math.abs(n).toLocaleString('en-US')));
export const fmtValue = (n: number) => {
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '-';
  return sign(r, Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: 2 }));
};
export const fmtRate = (n: number) => (n === 0 ? '-' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
export const fmtDiscount = (n: number) => (n === 0 ? '-' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);
export const figureColor = (n: number) => (n < 0 ? OUT_COLOR : TEXT);

export const TYPE_LABEL: Record<SaleDetailRow['kind'], string> = { SALE: 'Sale', RETURN: 'Return', BILL_DISCOUNT: 'Discount' };

export function SaleDetailHead({ nameHeader }: { nameHeader: string }) {
  const cell = (i: number, text: string, right = false) => (
    <th key={i} style={{ ...(right ? TH_R : TH), width: `${WIDTHS[i]}%` }}>{text}</th>
  );
  return (
    <thead>
      <tr>
        {cell(0, 'Date')}
        {cell(1, 'Type')}
        {cell(2, 'Bill No.')}
        {cell(3, nameHeader)}
        {cell(4, 'Color')}
        {cell(5, 'Cartons', true)}
        {cell(6, 'Pairs', true)}
        {cell(7, 'Rate', true)}
        {cell(8, 'Disc %', true)}
        {cell(9, 'Value', true)}
      </tr>
    </thead>
  );
}

/**
 * One line of either report. `name` is the Article (customer page) or the Customer (article page).
 * A BILL_DISCOUNT row has no article/figures of its own: its label spans the name and colour columns.
 */
export function SaleDetailLine({ row, name }: { row: SaleDetailRow; name: string }) {
  const color = figureColor(row.value);
  if (row.kind === 'BILL_DISCOUNT') {
    return (
      <tr>
        <td style={{ ...TD, fontFamily: 'monospace' }}>{formatDate(row.date)}</td>
        <td style={TD}>{TYPE_LABEL[row.kind]}</td>
        <td style={{ ...TD, fontFamily: 'monospace' }}>{row.bill_no}</td>
        <td colSpan={2} style={{ ...TD, fontStyle: 'italic' }}>Bill discount</td>
        <td style={TD_R}>-</td>
        <td style={TD_R}>-</td>
        <td style={TD_R}>-</td>
        <td style={TD_R}>-</td>
        <td style={{ ...TD_NUM, color }}>{fmtValue(row.value)}</td>
      </tr>
    );
  }
  const isReturn = row.kind === 'RETURN';
  return (
    <tr>
      <td style={{ ...TD, fontFamily: 'monospace' }}>{formatDate(row.date)}</td>
      <td style={{ ...TD, color: isReturn ? OUT_COLOR : TEXT, fontWeight: isReturn ? 'bold' : 'normal' }}>{TYPE_LABEL[row.kind]}</td>
      <td style={{ ...TD, fontFamily: 'monospace' }}>{row.bill_no}</td>
      <td style={{ ...TD, fontWeight: 'bold' }}>{name}</td>
      <td style={TD}>{row.color || '—'}</td>
      <td style={{ ...TD_R, color: figureColor(row.cartons) }}>{fmtCartons(row.cartons)}</td>
      <td style={{ ...TD_R, color: figureColor(row.pairs) }}>{fmtPairs(row.pairs)}</td>
      <td style={TD_R}>{fmtRate(row.rate)}</td>
      <td style={TD_R}>{fmtDiscount(row.discount_percent)}</td>
      <td style={{ ...TD_NUM, color }}>{fmtValue(row.value)}</td>
    </tr>
  );
}

/** A subtotal / total row: the label spans Date … Color, so the figures sit under their own columns. */
export function SaleDetailTotalRow({ label, totals, bold = true }: {
  label: string;
  totals: { cartons: number; pairs: number; value: number };
  bold?: boolean;
}) {
  return (
    <tr className="excel-print-total-row" style={{ fontWeight: bold ? 'bold' : 'normal', backgroundColor: '#f2f2f2' }}>
      <td colSpan={LABEL_COLUMNS} style={{ ...TOTAL_TD, textAlign: 'left' }}>{label}</td>
      <td style={{ ...TOTAL_TD_R, color: figureColor(totals.cartons) }}>{fmtCartons(totals.cartons)}</td>
      <td style={{ ...TOTAL_TD_R, color: figureColor(totals.pairs) }}>{fmtPairs(totals.pairs)}</td>
      <td style={TOTAL_TD_R} />
      <td style={TOTAL_TD_R} />
      <td style={{ ...TOTAL_TD_R, color: figureColor(totals.value) }}>{fmtValue(totals.value)}</td>
    </tr>
  );
}

export function SaleDetailDocHeader({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
      <div>
        <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{title}</h2>
        {lines.map((line, i) => (
          <p key={i} style={{ margin: i === 0 ? '6px 0 0 0' : '3px 0 0 0', fontSize: i === 0 ? '12px' : '11px', fontWeight: 'bold', color: '#111111' }}>{line}</p>
        ))}
        <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {formatDate(new Date())}</p>
      </div>
    </div>
  );
}

export function SaleDetailSignoff() {
  const sign = (label: string) => (
    <div style={{ textAlign: 'center', width: '150px' }}>
      <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
      <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>{label}</span>
    </div>
  );
  return (
    <>
      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
        {sign('Prepared By')}
        {sign('Audited By')}
        {sign('Authorized Sign')}
      </div>
      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDateTime(new Date())}</div>
      </div>
    </>
  );
}

/**
 * The typable picker used by both pages (the app's "type, then Enter opens a seeded SearchModal"
 * pattern): type a name and press Enter — the modal opens seeded with what was typed; Arrow Up/Down
 * open the full list; the chevron too.
 */
export function SaleDetailPicker({ label, options, value, onChange, placeholder, modalTitle, inputRef }: {
  label: string;
  options: SearchModalOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  modalTitle: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState('');

  // Show the picked option's label; typing never touches `value`, so this only runs on a selection.
  useEffect(() => {
    setText(options.find(o => o.value === value)?.label ?? '');
  }, [value, options]);

  const openBlank = () => { setSeed(''); setOpen(true); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      openBlank();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const direct = unchangedPick(value, options.find(o => o.value === value)?.label, text);
      if (direct) onChange(direct);
      else { setSeed(text); setOpen(true); }
    }
  };

  return (
    <div className="flex items-center gap-2 flex-1 min-w-[260px]">
      <label className="text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{label}:</label>
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          data-field-nav="true"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="soleria-input py-2 text-sm pr-9 w-full"
        />
        <button
          type="button"
          onClick={openBlank}
          title="Browse the full list"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <SearchModal
        isOpen={open}
        title={modalTitle}
        options={options}
        value={value}
        onSelect={v => { setOpen(false); onChange(v); }}
        onClose={() => setOpen(false)}
        searchPlaceholder="Search..."
        initialSearch={seed}
      />
    </div>
  );
}
