import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleReturnRow, CustomerRow, SubCustomerRow, CityRow } from '@/lib/api';
import { formatDate, formatCartons } from '@/lib/utils';
import { Calendar, Search, ArrowLeft, FileText, Edit2, Printer, ChevronDown, Check, MapPin } from 'lucide-react';

interface OverallReturnTabProps {
  onEditReturn: (ret: SaleReturnRow) => void;
  onPrintReturn: (ret: SaleReturnRow) => void;
}

export default function OverallReturnTab({ onEditReturn, onPrintReturn }: OverallReturnTabProps) {
  const [returns, setReturns] = useState<SaleReturnRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  useEffect(() => {
    (async () => {
      const [r, c, sc, ct] = await Promise.all([
        api.saleReturns.list({ range: 'overall' }),
        api.listCustomers(), api.listSubCustomers(), api.listCities()
      ]);
      if (r.ok) setReturns(r.data);
      if (c.ok) setCustomers(c.data);
      if (sc.ok) setSubCustomers(sc.data);
      if (ct.ok) setCities(ct.data);
    })();
  }, []);

  // Filters & Popover Dropdown States
  const [nameQuery, setNameQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');

  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);

  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const yearDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(e.target as Node)) {
        setIsMonthDropdownOpen(false);
      }
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(e.target as Node)) {
        setIsYearDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Selected customer for viewing details & Exit Animation State
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleBack = () => {
    setIsClosing(true);
    setTimeout(() => {
      setSelectedCustomerId(null);
      setIsClosing(false);
    }, 200);
  };

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

  const availableYears = useMemo(() => {
    const yearsSet = new Set<string>();
    const currentYr = new Date().getFullYear().toString();
    yearsSet.add(currentYr);

    returns.forEach(r => {
      if (r.return_date) {
        const yr = new Date(r.return_date).getFullYear().toString();
        if (!isNaN(Number(yr))) yearsSet.add(yr);
      }
    });

    return Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  }, [returns]);

  const selectedMonthLabel = useMemo(() => {
    if (selectedMonth === 'all') return 'All Months';
    return monthsList.find(m => m.value === selectedMonth)?.label || 'All Months';
  }, [selectedMonth]);

  const selectedYearLabel = useMemo(() => {
    if (selectedYear === 'all') return 'All Years';
    return selectedYear;
  }, [selectedYear]);

  // Client-side post-filter over the fetched returns
  const overallReturns = useMemo(() => {
    return returns.filter(ret => {
      const retDate = new Date(ret.return_date);
      const retMonth = retDate.getMonth().toString();
      const retYear = retDate.getFullYear().toString();

      if (selectedYear !== 'all') {
        if (retYear !== selectedYear) return false;
      }

      if (selectedMonth !== 'all') {
        if (retMonth !== selectedMonth) return false;
      }

      if (nameQuery.trim()) {
        const custName = customers.find(c => c.customer_id === ret.customer_id)?.name.toLowerCase() || '';
        if (!custName.includes(nameQuery.toLowerCase())) return false;
      }

      return true;
    });
  }, [returns, customers, selectedYear, selectedMonth, nameQuery]);

  // Group returns by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: number]: { customer: CustomerRow; returns: SaleReturnRow[]; totalCartons: number; totalPairs: number; totalValue: number } } = {};

    overallReturns.forEach(ret => {
      if (!groups[ret.customer_id]) {
        const cust = customers.find(c => c.customer_id === ret.customer_id) ||
          { customer_id: ret.customer_id, name: 'Walk-in Customer', ba_id: null, region_id: 0, city_id: null, address: null, is_active: true };
        groups[ret.customer_id] = {
          customer: cust,
          returns: [],
          totalCartons: 0,
          totalPairs: 0,
          totalValue: 0
        };
      }

      const grp = groups[ret.customer_id];
      grp.returns.push(ret);

      const retCartons = ret.total_cartons;
      const retPairs = ret.total_pairs;

      grp.totalCartons += retCartons;
      grp.totalPairs += retPairs;
      grp.totalValue += ret.net_value;
    });

    return Object.values(groups).sort((a, b) => b.totalValue - a.totalValue);
  }, [overallReturns, customers]);

  const activeCustomerDetails = useMemo(() => {
    if (selectedCustomerId == null) return null;
    return customerCardsData.find(c => c.customer.customer_id === selectedCustomerId);
  }, [selectedCustomerId, customerCardsData]);

  if (selectedCustomerId != null && activeCustomerDetails) {
    return (
      <div className={`mx-auto px-2 transition-all duration-200 ${
        isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'
      }`} style={{ maxWidth: 1750 }}>
        <div className="card-white p-6 bg-white border border-slate-200/80 shadow-md rounded-2xl mb-6">
          <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="w-10 h-10 rounded-full border border-slate-200/80 hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-all shadow-2xs hover:scale-105 cursor-pointer"
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <h3 className="font-lora font-bold text-xl text-slate-900">
                  Returns for {activeCustomerDetails.customer.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-inter">
                  Overall Summary: {activeCustomerDetails.returns.length} Return Record(s)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs hover:shadow-xs cursor-pointer hover:-translate-x-0.5"
            >
              <ArrowLeft size={14} className="text-amber-700" />
              <span>Back to Customers</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <table className="w-full text-left border-collapse text-sm font-inter">
              <thead>
                <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500 border-slate-200">
                  <th className="p-3.5 pl-4">Date</th>
                  <th className="p-3.5 text-center">Sys ID</th>
                  <th className="p-3.5 text-center">Return No.</th>
                  <th className="p-3.5">Delivery Agent</th>
                  <th className="p-3.5 text-center">Cartons</th>
                  <th className="p-3.5 text-center">Pairs</th>
                  <th className="p-3.5">Bilty No. / GP No.</th>
                  <th className="p-3.5 text-right pr-4">Total Credit</th>
                  <th className="p-3.5 text-center pr-4" style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {activeCustomerDetails.returns.map(ret => {
                  const subCust = ret.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === ret.sub_customer_id) : null;
                  const retCartons = ret.total_cartons;
                  const retPairs = ret.total_pairs;

                  return (
                    <tr key={ret.return_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3.5 pl-4 font-mono text-slate-600">{formatDate(ret.return_date)}</td>
                      <td className="p-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                          {ret.return_id}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-slate-800">{ret.bill_no}</td>
                      <td className="p-3.5 text-slate-600 font-medium">
                        {subCust ? (
                          <span className="text-slate-700">{subCust.name}</span>
                        ) : (
                          <span className="text-slate-400 italic text-xs">SAME (Direct)</span>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-mono font-semibold text-slate-700">{formatCartons(retCartons)}</td>
                      <td className="p-3.5 text-center font-mono font-semibold text-slate-700">{retPairs}</td>
                      <td className="p-3.5">
                        <div className="text-xs">
                          <span className="font-semibold block text-slate-700">Bilty: {ret.bilty_no || '-'}</span>
                          <span className="text-slate-400 block">GP: {ret.gp_no || '-'}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-amber-800 pr-4">{formatCurrency(ret.net_value)}</td>
                      <td className="p-3.5 text-center pr-4">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onEditReturn(ret)}
                            title="Edit Return"
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onPrintReturn(ret)}
                            title="Print Return"
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-500 hover:text-[var(--brand-gold)] transition-colors cursor-pointer"
                          >
                            <Printer size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto px-2" style={{ maxWidth: 1750 }}>
      {/* Filter Toolbar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs" style={{ borderColor: 'var(--border-color)' }}>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
          <input
            type="text"
            placeholder="Search by customer name..."
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            className="soleria-input pl-10 py-2 w-full text-sm font-medium"
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Custom Popover Dropdown for Month */}
          <div className="relative min-w-[160px]" ref={monthDropdownRef}>
            <button
              type="button"
              onClick={() => { setIsMonthDropdownOpen(!isMonthDropdownOpen); setIsYearDropdownOpen(false); }}
              className="flex items-center justify-between w-full pl-10 pr-3 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-xs font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3 top-2.5 text-slate-400" size={15} />
              <span className="truncate text-slate-800 font-semibold">{selectedMonthLabel}</span>
              <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isMonthDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={15} />
            </button>

            {isMonthDropdownOpen && (
              <div
                className="absolute right-0 w-44 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin"
                style={{ boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedMonth('all'); setIsMonthDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
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
                      className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--brand-gold)] text-white font-semibold'
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

          {/* Custom Popover Dropdown for Year */}
          <div className="relative min-w-[140px]" ref={yearDropdownRef}>
            <button
              type="button"
              onClick={() => { setIsYearDropdownOpen(!isYearDropdownOpen); setIsMonthDropdownOpen(false); }}
              className="flex items-center justify-between w-full pl-9 pr-3 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-xs font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3 top-2.5 text-slate-400" size={15} />
              <span className="truncate text-slate-800 font-semibold">{selectedYearLabel}</span>
              <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isYearDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={15} />
            </button>

            {isYearDropdownOpen && (
              <div
                className="absolute right-0 w-40 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin"
                style={{ boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedYear('all'); setIsYearDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                    selectedYear === 'all'
                      ? 'bg-[var(--brand-gold)] text-white'
                      : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                  }`}
                >
                  <span>All Years</span>
                  {selectedYear === 'all' && <Check size={14} className="text-white" />}
                </button>
                <div className="my-1 border-t border-slate-100" />
                {availableYears.map(yr => {
                  const isSelected = selectedYear === yr;
                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => { setSelectedYear(yr); setIsYearDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--brand-gold)] text-white font-semibold'
                          : 'text-slate-700 hover:bg-[#fbf7f0] hover:text-[var(--brand-navy)]'
                      }`}
                    >
                      <span>{yr}</span>
                      {isSelected && <Check size={14} className="text-white" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-xs font-semibold text-amber-900 bg-amber-50/90 border border-amber-200/70 px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-2xs">
            <FileText size={14} className="text-amber-600" />
            <span>{overallReturns.length} Return Records</span>
          </div>
        </div>
      </div>

      {/* Customer Cards Grid */}
      {/* RJ-05 pattern: customer records as table rows, not cards — the same treatment the Receipts
          and Expenses tabs already got, so every records screen in the app reads the same way. A row
          is ~40px against a 190px card three-across, so roughly four times as many customers fit
          without scrolling, and there is now room for the cartons/pairs/value totals this view was
          already computing and then throwing away. */}
      <div className="card-white overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
              <th className="p-3 pl-4">Customer</th>
              <th className="p-3 text-center">City</th>
              <th className="p-3 text-center">Returns</th>
              <th className="p-3 text-right">Cartons</th>
              <th className="p-3 text-right">Pairs</th>
              <th className="p-3 text-right pr-6">Total Value</th>
            </tr>
          </thead>
          <tbody>
            {customerCardsData.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center p-12 text-slate-400">
                  <Calendar size={40} className="text-slate-300 mb-2 mx-auto" />
                  <p className="font-lora text-base font-semibold text-slate-500 mb-1">No Overall Returns Found</p>
                  <p className="text-xs max-w-sm mx-auto">No sale returns were recorded matching your filters.</p>
                </td>
              </tr>
            ) : (
              customerCardsData.map(data => {
                const city = cities.find(c => c.city_id === data.customer.city_id)?.name || 'Local';

                return (
                  <tr
                    key={data.customer.customer_id}
                    onClick={() => setSelectedCustomerId(data.customer.customer_id)}
                    className="border-b hover:bg-slate-50/60 cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border-table)' }}
                  >
                    <td className="p-3 pl-4">
                      <div className="font-lora font-bold text-slate-900">{data.customer.name}</div>
                      {/* C-01: the account code, matching what the Customer setup screen now shows. */}
                      <div className="font-mono text-[11px] text-slate-400">
                        Code: {data.customer.account_code ?? '—'}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider inline-flex items-center gap-1">
                        <MapPin size={10} className="text-slate-400" />
                        {city}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-900 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-200/80">
                        <FileText size={13} className="text-amber-600" />
                        {data.returns.length} {data.returns.length === 1 ? 'Return' : 'Returns'}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-slate-700">{formatCartons(data.totalCartons)}</td>
                    <td className="p-3 text-right font-mono text-slate-700">{data.totalPairs.toLocaleString()}</td>
                    <td className="p-3 text-right pr-6 font-mono font-bold text-emerald-700">{formatCurrency(data.totalValue)}</td>
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
