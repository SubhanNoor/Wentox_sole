import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { ReceiptRow, BusinessAccountRow, CityRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard, ChevronDown, Check, MapPin } from 'lucide-react';

export default function OverallReceiptsTab() {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [accounts, setAccounts] = useState<BusinessAccountRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  useEffect(() => {
    (async () => {
      const [r, c, ct] = await Promise.all([
        api.receipts.list({ range: 'overall' }),
        api.listBusinessAccounts(), api.listCities()
      ]);
      if (r.ok) setRows(r.data);
      if (c.ok) setAccounts(c.data);
      if (ct.ok) setCities(ct.data);
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

  // Selected customer for viewing details
  const [selectedAccountId, setSelectedCustomerId] = useState<number | null>(null);

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
    rows.forEach(r => {
      if (r.receipt_date) {
        const parts = r.receipt_date.split('-');
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

  const overallReceipts = useMemo(() => {
    return rows.filter(r => {
      let rYear = '';
      let rMonth = '';

      if (r.receipt_date) {
        const parts = r.receipt_date.split('-');
        if (parts[0]) rYear = parts[0];
        if (parts[1]) {
          const mVal = parseInt(parts[1], 10) - 1;
          rMonth = mVal.toString();
        }
      }

      if (selectedYear !== 'all') {
        if (rYear !== selectedYear) return false;
      }

      if (selectedMonth !== 'all') {
        if (rMonth !== selectedMonth) return false;
      }

      if (nameQuery.trim()) {
        const label = (r.account_name || accounts.find(a => a.ba_id === r.ba_id)?.name || '').toLowerCase();
        if (!label.includes(nameQuery.toLowerCase())) return false;
      }

      return true;
    });
  }, [rows, accounts, selectedYear, selectedMonth, nameQuery]);

  const accountCardsData = useMemo(() => {
    // Keyed on ba_id: a receipt names a business account, which may belong to a customer, a
    // director, an employee or a bank (migration 014).
    const groups: { [baId: number]: { account: BusinessAccountRow; receipts: ReceiptRow[]; totalAmount: number } } = {};

    overallReceipts.forEach(r => {
      if (!groups[r.ba_id]) {
        const account = accounts.find(a => a.ba_id === r.ba_id) || {
          ba_id: r.ba_id, code: '', name: r.account_name || 'Unknown Account', ac_id: 0,
          region_id: null, city_id: null, opening_balance: null, opening_date: null,
          status: 'ACTIVE' as const,
        };
        groups[r.ba_id] = {
          account,
          receipts: [],
          totalAmount: 0
        };
      }

      const grp = groups[r.ba_id];
      grp.receipts.push(r);
      grp.totalAmount += r.amount;
    });

    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [overallReceipts, accounts]);

  const activeAccountDetails = useMemo(() => {
    if (selectedAccountId == null) return null;
    return accountCardsData.find(g => g.account.ba_id === selectedAccountId);
  }, [selectedAccountId, accountCardsData]);

  if (selectedAccountId != null && activeAccountDetails) {
    return (
      <div className="card-white p-6 bg-white border border-slate-200 shadow-sm rounded-xl animate-in fade-in slide-in-from-bottom-3 duration-300">
        <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCustomerId(null)}
              className="bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:shadow-xs"
            >
              <ArrowLeft size={16} /> Back to Receipts
            </button>
            <div>
              <h3 className="font-lora font-bold text-lg text-slate-800">
                {activeAccountDetails.account.name} — Financial Receipts Ledger
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Account: #{activeAccountDetails.account.code || activeAccountDetails.account.ba_id}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-slate-500 block uppercase">Total Receipts:</span>
            <span className="font-mono font-bold text-emerald-800 text-lg">{formatCurrency(activeAccountDetails.totalAmount)}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                <th className="p-3.5 pl-4">Date</th>
                <th className="p-3.5 text-center">Receipt ID</th>
                <th className="p-3.5 text-center">Mode</th>
                <th className="p-3.5">Details</th>
                <th className="p-3.5">Remarks</th>
                <th className="p-3.5 text-right pr-6">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeAccountDetails.receipts.map(r => (
                <tr key={r.receipt_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{formatDate(r.receipt_date)}</td>
                  <td className="p-3.5 text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                      #{r.receipt_id}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${r.payment_mode === 'CASH' ? 'bg-green-50 text-green-700 border border-green-200' : r.payment_mode === 'CHEQUE' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                      {r.payment_mode === 'CASH' && <DollarSign size={10} />}
                      {r.payment_mode === 'CHEQUE' && <Landmark size={10} />}
                      {r.payment_mode === 'ONLINE' && <CreditCard size={10} />}
                      {r.payment_mode}
                    </span>
                  </td>
                  <td className="p-3.5 text-slate-600 font-medium">{r.details || '-'}</td>
                  <td className="p-3.5 text-slate-500 text-xs">{r.remarks || '-'}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-emerald-800 pr-6">{formatCurrency(r.amount)}</td>
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
              placeholder="Search by customer name..."
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
          {overallReceipts.length} Receipt Records
        </div>
      </div>

      {/* Customer Cards Grid Standard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accountCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-white border border-slate-200 text-center flex flex-col items-center justify-center text-slate-400 rounded-2xl">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Receipts Found</p>
            <p className="text-sm max-w-sm">No receipts were logged matching your search filters.</p>
          </div>
        ) : (
          accountCardsData.map(data => {
            const city = cities.find(c => c.city_id === data.account.city_id)?.name || 'Local';

            return (
              <div
                key={data.account.ba_id}
                onClick={() => setSelectedCustomerId(data.account.ba_id)}
                className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors truncate">
                      {data.account.name}
                    </h4>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider shrink-0 flex items-center gap-1">
                      <MapPin size={10} className="text-slate-400" />
                      {city}
                    </span>
                  </div>

                  <div className="font-mono text-xs text-slate-400 mb-3">Code: #{data.account.code || data.account.ba_id}</div>

                  <div className="text-xs font-semibold text-slate-700 flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-2">
                    <span>Total Jamma:</span>
                    <span className="font-mono font-bold text-emerald-700">{formatCurrency(data.totalAmount)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                  <div className="flex items-center gap-1.5 bg-amber-50 text-amber-900 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-200/80">
                    <FileText size={13} className="text-amber-600" />
                    <span>{data.receipts.length} {data.receipts.length === 1 ? 'Receipt' : 'Receipts'}</span>
                  </div>
                  <span className="text-[var(--brand-gold)] font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                    View Receipts <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
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
