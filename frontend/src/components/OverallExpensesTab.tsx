import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { ExpenseRow, BusinessAccountRow } from '@/lib/api';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard, ChevronDown, Check } from 'lucide-react';

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

export default function OverallExpensesTab() {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);

  useEffect(() => {
    (async () => {
      const [e, b] = await Promise.all([
        api.expenses.list({ range: 'overall' }),
        api.listBusinessAccounts()
      ]);
      if (e.ok) setRows(e.data);
      if (b.ok) setBusinessAccounts(b.data);
    })();
  }, []);

  // Filters
  const [nameQuery, setNameQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const yearDropdownRef = useRef<HTMLDivElement>(null);

  // Selected business account for viewing details
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);

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

  const yearsList = useMemo(() => {
    const years = new Set<string>();
    rows.forEach(e => {
      if (e.expense_date) {
        const parts = e.expense_date.split('-');
        if (parts[0] && parts[0].length === 4) {
          years.add(parts[0]);
        }
      }
    });
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Click outside listener for custom dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(event.target as Node)) {
        setIsMonthDropdownOpen(false);
      }
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target as Node)) {
        setIsYearDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const overallExpenses = useMemo(() => {
    return rows.filter(e => {
      let eYear = '';
      let eMonth = '';

      if (e.expense_date) {
        const parts = e.expense_date.split('-');
        if (parts[0]) eYear = parts[0];
        if (parts[1]) {
          const mVal = parseInt(parts[1], 10) - 1;
          eMonth = mVal.toString();
        }
      }

      if (selectedYear !== 'all') {
        if (eYear !== selectedYear) return false;
      }

      if (selectedMonth !== 'all') {
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
  }, [rows, businessAccounts, selectedYear, selectedMonth, nameQuery]);

  const bizCardsData = useMemo(() => {
    const groups: { [bizId: number]: { businessAccount: BusinessAccountRow; expenses: ExpenseRow[]; totalAmount: number } } = {};

    overallExpenses.forEach(e => {
      if (!groups[e.ba_id]) {
        const biz = businessAccounts.find(b => b.ba_id === e.ba_id) ||
          { ba_id: e.ba_id, code: '', name: 'General Expense Account', ac_id: 0, region_id: null, city_id: null, opening_balance: null, opening_date: null, status: 'ACTIVE' as const };
        groups[e.ba_id] = {
          businessAccount: biz,
          expenses: [],
          totalAmount: 0
        };
      }

      const grp = groups[e.ba_id];
      grp.expenses.push(e);
      grp.totalAmount += e.amount;
    });

    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [overallExpenses, businessAccounts]);

  const activeBizDetails = useMemo(() => {
    if (selectedBizId == null) return null;
    return bizCardsData.find(c => c.businessAccount.ba_id === selectedBizId);
  }, [selectedBizId, bizCardsData]);

  if (selectedBizId != null && activeBizDetails) {
    return (
      <div className="card-white p-6 bg-white border border-slate-200 shadow-sm rounded-xl animate-in fade-in slide-in-from-bottom-3 duration-300">
        <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedBizId(null)}
              className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
            >
              <ArrowLeft size={16} /> Back to Expenses
            </button>
            <div>
              <h3 className="font-lora font-bold text-lg text-slate-800">
                {activeBizDetails.businessAccount.name} — Expenses Ledger
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Code: {activeBizDetails.businessAccount.code}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-slate-500 block uppercase">Total Expenses:</span>
            <span className="font-mono font-bold text-rose-800 text-lg">{formatCurrency(activeBizDetails.totalAmount)}</span>
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
              {activeBizDetails.expenses.map(e => (
                <tr key={e.expense_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{e.expense_date.slice(0, 10)}</td>
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
    <div className="mx-auto" style={{ maxWidth: 1400 }}>
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

          {/* Month Popover Dropdown */}
          <div className="relative min-w-[170px]" ref={monthDropdownRef}>
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

          {/* Year Popover Dropdown */}
          <div className="relative min-w-[140px]" ref={yearDropdownRef}>
            <button
              type="button"
              onClick={() => setIsYearDropdownOpen(!isYearDropdownOpen)}
              className="flex items-center justify-between w-full pl-10 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
              <span className="truncate text-slate-800 font-semibold">{selectedYear === 'all' ? 'All Years' : selectedYear}</span>
              <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isYearDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={16} />
            </button>

            {isYearDropdownOpen && (
              <div className="absolute right-0 w-44 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin">
                <button
                  type="button"
                  onClick={() => { setSelectedYear('all'); setIsYearDropdownOpen(false); }}
                  className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                    selectedYear === 'all'
                      ? 'bg-[var(--brand-gold)] text-white'
                      : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                  }`}
                >
                  <span>All Years</span>
                  {selectedYear === 'all' && <Check size={14} className="text-white" />}
                </button>
                <div className="my-1 border-t border-slate-100" />
                {yearsList.map(y => {
                  const isSelected = selectedYear === y;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => { setSelectedYear(y); setIsYearDropdownOpen(false); }}
                      className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--brand-gold)] text-white'
                          : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                      }`}
                    >
                      <span>{y}</span>
                      {isSelected && <Check size={14} className="text-white" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
          {overallExpenses.length} Expense Records
        </div>
      </div>

      {/* Business Account Cards Grid Standard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bizCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-white border border-slate-200 text-center flex flex-col items-center justify-center text-slate-400 rounded-2xl">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Expenses Found</p>
            <p className="text-sm max-w-sm">No expenses were logged matching your search filters.</p>
          </div>
        ) : (
          bizCardsData.map(data => {
            return (
              <div
                key={data.businessAccount.ba_id}
                onClick={() => setSelectedBizId(data.businessAccount.ba_id)}
                className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                      {data.businessAccount.name}
                    </h4>
                    {data.businessAccount.ac_code === '210001' && (
                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300 uppercase tracking-wider shrink-0">
                        Vendor Payment
                      </span>
                    )}
                  </div>

                  <div className="font-mono text-xs text-slate-400 mb-3">Code: {data.businessAccount.code}</div>

                  <div className="text-xs font-semibold text-slate-700 flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-2">
                    <span>Total Expense:</span>
                    <span className="font-mono font-bold text-rose-700">{formatCurrency(data.totalAmount)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                  <div className="flex items-center gap-1.5 bg-rose-50 text-rose-900 px-2.5 py-1 rounded-full text-xs font-semibold border border-rose-200/80">
                    <FileText size={13} className="text-rose-600" />
                    <span>{data.expenses.length} {data.expenses.length === 1 ? 'Record' : 'Records'}</span>
                  </div>
                  <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                    View Records <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
