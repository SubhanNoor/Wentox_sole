import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { ExpenseRow, BusinessAccountRow, ExpenseVoucherRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Calendar, Search, ArrowLeft, FileText, DollarSign, Landmark, CreditCard, ChevronDown, Check, Undo2 } from 'lucide-react';

function isChequeMode(mode: ExpenseRow['payment_mode']): boolean {
  return mode === 'CHEQUE_ENDORSED' || mode === 'CHEQUE_ISSUED';
}

function expenseModeLabel(mode: ExpenseRow['payment_mode']): string {
  switch (mode) {
    case 'CHEQUE_ENDORSED': return 'Cheque (Endorsed)';
    case 'CHEQUE_ISSUED': return 'Cheque (Issued)';
    case 'ONLINE': return 'Online';
    default: return 'Cash';
  }
}

interface WeeklyExpensesTabProps {
  /** Called after a successful Unpost here — the parent (ExpensesPage) switches back to Expense
   * Entry and loads that same voucher on screen, same correction made on Receipts (2026-08-26):
   * posting status belongs to the whole voucher, and expenses.list() only ever returns posted
   * lines, so the group this tab shows no longer exists here once unposted. */
  onVoucherUnposted: (voucherId: number) => void | Promise<void>;
}

export default function WeeklyExpensesTab({ onVoucherUnposted }: WeeklyExpensesTabProps) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  // Voucher headers (voucher_no, remarks, status) — the outer table groups by VOUCHER, not
  // account, mirroring the identical correction on the Receipts records tabs.
  const [vouchers, setVouchers] = useState<ExpenseVoucherRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const refreshAll = async () => {
    const [e, b, v] = await Promise.all([
      api.expenses.list({ range: 'weekly' }),
      api.listBusinessAccounts(),
      api.expenseVouchers.list({})
    ]);
    if (e.ok) setRows(e.data);
    if (b.ok) setBusinessAccounts(b.data);
    if (v.ok) setVouchers(v.data);
  };

  useEffect(() => { refreshAll(); }, []);

  const voucherLookup = useMemo(() => new Map(vouchers.map(v => [v.voucher_id, v])), [vouchers]);

  // Filters
  const [nameQuery, setNameQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Selected voucher for viewing its expenses
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);

  const monthsList = [
    { value: '0', label: 'January' },
    { value: '1', label: 'February' },
    { value: '2', label: 'March' },
    { value: '3', label: 'April' },
    { value: '4', label: 'May' },
    { value: '5', label: 'June' },
    { value: '6', label: 'July' },
    { value: '7', label: 'August' },
    { value: '8', label: 'September' },
    { value: '9', label: 'October' },
    { value: '10', label: 'November' },
    { value: '11', label: 'December' },
  ];

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === 'all') return 'All Months';
    return monthsList.find(m => m.value === selectedMonth)?.label || 'All Months';
  }, [selectedMonth]);

  // Click outside listener for custom dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMonthDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const weeklyExpenses = useMemo(() => {
    return rows.filter(e => {
      if (selectedMonth !== 'all') {
        const eMonth = new Date(e.expense_date).getMonth().toString();
        if (eMonth !== selectedMonth) return false;
      }

      if (nameQuery.trim()) {
        const biz = businessAccounts.find(b => b.ba_id === e.ba_id);
        const bizName = biz?.name.toLowerCase() || '';
        const bizCode = biz?.code.toLowerCase() || '';
        const query = nameQuery.toLowerCase();
        if (!bizName.includes(query) && !bizCode.includes(query)) return false;
      }

      return true;
    });
  }, [rows, businessAccounts, selectedMonth, nameQuery]);

  const voucherCardsData = useMemo(() => {
    const groups: { [voucherId: number]: { voucherId: number; expenses: ExpenseRow[]; totalAmount: number } } = {};

    weeklyExpenses.forEach(e => {
      const vid = e.voucher_id;
      if (vid == null) return; // every expense has one per migration 022's backfill — guard anyway
      if (!groups[vid]) groups[vid] = { voucherId: vid, expenses: [], totalAmount: 0 };
      const grp = groups[vid];
      grp.expenses.push(e);
      grp.totalAmount += e.amount;
    });

    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [weeklyExpenses]);

  const activeVoucherDetails = useMemo(() => {
    if (selectedVoucherId == null) return null;
    return voucherCardsData.find(g => g.voucherId === selectedVoucherId);
  }, [selectedVoucherId, voucherCardsData]);

  const activeVoucherHeader = selectedVoucherId != null ? voucherLookup.get(selectedVoucherId) : undefined;

  const [unpostBusy, setUnpostBusy] = useState(false);
  const handleUnpostVoucher = async () => {
    if (selectedVoucherId == null) return;
    setUnpostBusy(true);
    const res = await api.expenseVouchers.unpost(selectedVoucherId);
    setUnpostBusy(false);
    if (!res.ok) { setErrorMsg('Failed to unpost voucher: ' + res.error.message); return; }
    setErrorMsg('');
    const voucherId = selectedVoucherId;
    setSelectedVoucherId(null); // its lines just left expenses.list() — the group no longer exists here
    await refreshAll();
    await onVoucherUnposted(voucherId);
  };

  if (selectedVoucherId != null && activeVoucherDetails) {
    return (
      <div className="card-white p-6 bg-white border border-slate-200 shadow-sm rounded-xl animate-in fade-in slide-in-from-bottom-3 duration-300">
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
        )}
        <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedVoucherId(null)}
              className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
            >
              <ArrowLeft size={16} /> Back to Expenses
            </button>
            <div>
              <h3 className="font-lora font-bold text-lg text-slate-800">
                Voucher #{activeVoucherHeader?.voucher_no ?? selectedVoucherId} — Weekly Expenses
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                {activeVoucherHeader?.remarks || 'No remarks'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-500 block uppercase">Total Weekly Expense:</span>
              <span className="font-mono font-bold text-rose-800 text-lg">{formatCurrency(activeVoucherDetails.totalAmount)}</span>
            </div>
            <button
              type="button"
              onClick={handleUnpostVoucher}
              disabled={unpostBusy}
              title="Unpost this whole voucher"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white shadow-sm transition-all"
            >
              <Undo2 size={14} /> {unpostBusy ? 'Working…' : 'Unpost'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                <th className="p-3.5 pl-4">Date</th>
                <th className="p-3.5 text-center">Entry ID</th>
                <th className="p-3.5 text-center">Payment Mode</th>
                <th className="p-3.5">Details</th>
                <th className="p-3.5">Remarks</th>
                <th className="p-3.5 text-right pr-6">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeVoucherDetails.expenses.map(e => (
                <tr key={e.expense_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{formatDate(e.expense_date)}</td>
                  <td className="p-3.5 text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                      #{e.expense_id}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      isChequeMode(e.payment_mode)
                        ? 'bg-amber-50 text-amber-900 border border-amber-200/80'
                        : e.payment_mode === 'ONLINE'
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        : 'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {!isChequeMode(e.payment_mode) && e.payment_mode === 'CASH' && <DollarSign size={10} />}
                      {isChequeMode(e.payment_mode) && <Landmark size={10} />}
                      {e.payment_mode === 'ONLINE' && <CreditCard size={10} />}
                      {expenseModeLabel(e.payment_mode)}
                    </span>
                  </td>
                  <td className="p-3.5 text-slate-600 font-medium">{e.details || '-'}</td>
                  <td className="p-3.5 text-slate-500 text-xs">{e.remarks || '-'}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-rose-800 pr-6">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1750 }}>
      {errorMsg && (
        <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>
      )}
      {/* Filter Toolbar Standard */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by account name or code..."
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              className="soleria-input pl-10 py-2 w-full text-sm font-semibold"
            />
          </div>

          {/* Custom Popover Dropdown Standard */}
          <div className="relative min-w-[170px]" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsMonthDropdownOpen(!isMonthDropdownOpen)}
              className="flex items-center justify-between w-full pl-10 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
              <span className="truncate text-slate-800 font-semibold">{selectedMonthLabel}</span>
              <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isMonthDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={16} />
            </button>

            {isMonthDropdownOpen && (
              <div className="absolute right-0 w-48 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin">
                <button
                  type="button"
                  onClick={() => { setSelectedMonth('all'); setIsMonthDropdownOpen(false); }}
                  className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                    selectedMonth === 'all'
                      ? 'bg-[var(--brand-gold)] text-white'
                      : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                  }`}
                >
                  <span>All Months</span>
                  {selectedMonth === 'all' && <Check size={14} className="text-white" />}
                </button>
                <div className="my-1 border-t border-slate-100" />
                {monthsList.map(m => {
                  const isSelected = selectedMonth === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => { setSelectedMonth(m.value); setIsMonthDropdownOpen(false); }}
                      className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--brand-gold)] text-white'
                          : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                      }`}
                    >
                      <span>{m.label}</span>
                      {isSelected && <Check size={14} className="text-white" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
          {weeklyExpenses.length} Expense Records
        </div>
      </div>

      {/* PN-01/RJ-05: voucher records as table rows — grouped by VOUCHER, not account (corrected
          per the user 2026-08-26, same fix as Receipts): Account column removed, C.Book No/Date/
          Remarks (the voucher's own) added. */}
      <div className="card-white overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
              <th className="p-3 pl-4">C.Book No</th>
              <th className="p-3">Date</th>
              <th className="p-3">Remarks</th>
              <th className="p-3 text-center">Records</th>
              <th className="p-3 text-right pr-6">Total Expense</th>
            </tr>
          </thead>
          <tbody>
            {voucherCardsData.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center p-12 text-slate-400">
                  <Calendar size={40} className="text-slate-300 mb-2 mx-auto" />
                  <p className="font-lora text-base font-semibold text-slate-500 mb-1">No Weekly Expenses Found</p>
                  <p className="text-xs max-w-sm mx-auto">No expenses were logged for this week matching your filters.</p>
                </td>
              </tr>
            ) : (
              voucherCardsData.map(data => {
                const header = voucherLookup.get(data.voucherId);
                return (
                  <tr
                    key={data.voucherId}
                    onClick={() => setSelectedVoucherId(data.voucherId)}
                    className="border-b hover:bg-slate-50/60 cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td className="p-3 pl-4">
                      <div className="font-lora font-bold text-slate-900">#{header?.voucher_no ?? data.voucherId}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-600">
                      {header ? formatDate(header.voucher_date) : formatDate(data.expenses[0]?.expense_date)}
                    </td>
                    <td className="p-3 text-slate-500 text-xs">{header?.remarks || '-'}</td>
                    <td className="p-3 text-center">
                      <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-900 px-2.5 py-1 rounded-full text-xs font-semibold border border-rose-200/80">
                        <FileText size={13} className="text-rose-600" />
                        {data.expenses.length} {data.expenses.length === 1 ? 'Record' : 'Records'}
                      </span>
                    </td>
                    <td className="p-3 text-right pr-6 font-mono font-bold text-rose-700">{formatCurrency(data.totalAmount)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
