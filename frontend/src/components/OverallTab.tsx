import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleBillRow, CustomerRow, SubCustomerRow, AddaRow, CityRow } from '@/lib/api';
import { formatDate, formatCartons } from '@/lib/utils';
import { Calendar, Search, ArrowLeft, FileText, Edit2, Printer, ChevronDown, Check, MapPin } from 'lucide-react';

interface OverallTabProps {
  onEditBill: (bill: SaleBillRow) => void;
  onPrintBill: (bill: SaleBillRow) => void;
}

export default function OverallTab({ onEditBill, onPrintBill }: OverallTabProps) {
  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  useEffect(() => {
    (async () => {
      const [b, c, sc, ad, ct] = await Promise.all([
        api.saleBills.list({ range: 'overall' }),
        api.listCustomers(), api.listSubCustomers(), api.listAddas(), api.listCities()
      ]);
      if (b.ok) setBills(b.data);
      if (c.ok) setCustomers(c.data);
      if (sc.ok) setSubCustomers(sc.data);
      if (ad.ok) setAddas(ad.data);
      if (ct.ok) setCities(ct.data);
    })();
  }, []);

  // Filters
  const [nameQuery, setNameQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // Default to all
  const [selectedYear, setSelectedYear] = useState<string>('all'); // Default to all

  // Custom Popover Dropdown States
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
  const monthDropdownRef = useRef<HTMLDivElement>(null);
  const yearDropdownRef = useRef<HTMLDivElement>(null);

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

  // Selected customer for viewing details
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

  // Extract unique years from sale bills for the filter
  const yearsList = useMemo(() => {
    const years = new Set<string>();
    bills.forEach(bill => {
      if (bill.bill_date) {
        const parts = bill.bill_date.split('-');
        if (parts[0] && parts[0].length === 4) {
          years.add(parts[0]);
        }
      }
    });
    // Always guarantee current year is in the list
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [bills]);

  // Filtered bills + filter inputs
  const overallBills = useMemo(() => {
    return bills.filter(bill => {
      let billYear = '';
      let billMonth = '';

      if (bill.bill_date) {
        const parts = bill.bill_date.split('-');
        if (parts[0]) billYear = parts[0];
        if (parts[1]) {
          const mVal = parseInt(parts[1], 10) - 1;
          billMonth = mVal.toString();
        }
      }

      // 1. Filter by year if selected
      if (selectedYear !== 'all') {
        if (billYear !== selectedYear) return false;
      }

      // 2. Filter by month if selected
      if (selectedMonth !== 'all') {
        if (billMonth !== selectedMonth) return false;
      }

      // 3. Filter by customer name
      if (nameQuery.trim()) {
        const custName = customers.find(c => c.customer_id === bill.customer_id)?.name.toLowerCase() || '';
        if (!custName.includes(nameQuery.toLowerCase())) return false;
      }

      return true;
    });
  }, [bills, customers, selectedYear, selectedMonth, nameQuery]);

  // Group bills by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: number]: { customer: CustomerRow; bills: SaleBillRow[]; totalCartons: number; totalPairs: number; totalValue: number } } = {};

    overallBills.forEach(bill => {
      if (!groups[bill.customer_id]) {
        const cust = customers.find(c => c.customer_id === bill.customer_id) ||
          { customer_id: bill.customer_id, name: 'Walk-in Customer', ba_id: null, region_id: 0, city_id: null, address: null, is_active: true };
        groups[bill.customer_id] = {
          customer: cust,
          bills: [],
          totalCartons: 0,
          totalPairs: 0,
          totalValue: 0
        };
      }

      const grp = groups[bill.customer_id];
      grp.bills.push(bill);

      const billCartons = bill.total_cartons;
      const billPairs = bill.total_pairs;

      grp.totalCartons += billCartons;
      grp.totalPairs += billPairs;
      grp.totalValue += bill.net_value;
    });

    return Object.values(groups).sort((a, b) => b.totalValue - a.totalValue);
  }, [overallBills, customers]);

  const activeCustomerDetails = useMemo(() => {
    if (selectedCustomerId == null) return null;
    return customerCardsData.find(c => c.customer.customer_id === selectedCustomerId);
  }, [selectedCustomerId, customerCardsData]);

  if (selectedCustomerId != null && activeCustomerDetails) {
    return (
      <div className={`card-white p-6 bg-white border border-slate-200/80 shadow-md rounded-2xl transition-all duration-200 ${
        isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'
      }`}>
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
                Bills for {activeCustomerDetails.customer.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-inter">
                Overall Summary: {activeCustomerDetails.bills.length} Invoice(s)
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
                <th className="p-3.5 text-center">Bill No.</th>
                <th className="p-3.5">Sub-Customer</th>
                <th className="p-3.5 text-center">Cartons</th>
                <th className="p-3.5 text-center">Pairs</th>
                <th className="p-3.5">Bilty No. / Adda</th>
                <th className="p-3.5 text-right pr-4">Invoice Value</th>
                <th className="p-3.5 text-center pr-4" style={{ width: '120px' }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeCustomerDetails.bills.map(bill => {
                const subCust = bill.sub_customer_id ? subCustomers.find(sc => sc.sub_customer_id === bill.sub_customer_id) : null;
                const adda = addas.find(ad => ad.adda_id === bill.adda_id);
                const billCartons = bill.total_cartons;
                const billPairs = bill.total_pairs;

                return (
                  <tr key={bill.bill_id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3.5 pl-4 font-mono text-slate-600">{formatDate(bill.bill_date)}</td>
                    <td className="p-3.5 text-center">
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                        {bill.bill_id}
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-mono font-bold text-slate-800">{bill.bill_no}</td>
                    <td className="p-3.5 text-slate-600 font-medium">
                      {subCust ? (
                        <span className="text-slate-700">{subCust.name}</span>
                      ) : (
                        <span className="text-slate-400 italic text-xs">SAME (Direct)</span>
                      )}
                    </td>
                    <td className="p-3.5 text-center font-mono font-semibold text-slate-700">{formatCartons(billCartons)}</td>
                    <td className="p-3.5 text-center font-mono font-semibold text-slate-700">{billPairs}</td>
                    <td className="p-3.5">
                      <div className="text-xs">
                        <span className="font-semibold block text-slate-700">Bilty: {bill.bilty_no || '-'}</span>
                        <span className="text-slate-400 block">{adda ? adda.name : 'No Transport'}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-emerald-800 pr-4">{formatCurrency(bill.net_value)}</td>
                    <td className="p-3.5 text-center pr-4">
                      <div className="flex justify-center items-center gap-3">
                          <button
                            onClick={() => onEditBill(bill)}
                            title="Edit Bill"
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => onPrintBill(bill)}
                            title="Print Bill"
                            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-[#B08D57] transition-colors"
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
    );
  }

  return (
    <div className="mx-auto px-2" style={{ maxWidth: 1750 }}>
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-2.5 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by customer name..."
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              className="soleria-input pl-10 py-2 w-full text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Custom Brand Month Dropdown */}
          <div className="relative min-w-[170px]" ref={monthDropdownRef}>
            <button
              type="button"
              onClick={() => { setIsMonthDropdownOpen(!isMonthDropdownOpen); setIsYearDropdownOpen(false); }}
              className="flex items-center justify-between w-full pl-10 pr-3.5 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
              <span className="truncate text-slate-800 font-semibold">
                {selectedMonth === 'all' ? 'All Months' : (monthsList.find(m => m.value === selectedMonth)?.label || 'All Months')}
              </span>
              <ChevronDown
                className={`text-slate-400 transition-transform duration-200 ${isMonthDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`}
                size={16}
              />
            </button>

            {isMonthDropdownOpen && (
              <div
                className="absolute right-0 w-48 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin"
                style={{ boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedMonth('all'); setIsMonthDropdownOpen(false); }}
                  className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${selectedMonth === 'all'
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
                      className={`w-full text-left px-3.5 py-2 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${isSelected
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

          {/* Custom Brand Year Dropdown */}
          <div className="relative min-w-[130px]" ref={yearDropdownRef}>
            <button
              type="button"
              onClick={() => { setIsYearDropdownOpen(!isYearDropdownOpen); setIsMonthDropdownOpen(false); }}
              className="flex items-center justify-between w-full pl-9 pr-3 py-2 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium text-slate-700 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--brand-gold)]/30 focus:border-[var(--brand-gold)] shadow-2xs"
            >
              <Calendar className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <span className="truncate text-slate-800 font-semibold">
                {selectedYear === 'all' ? 'All Years' : selectedYear}
              </span>
              <ChevronDown
                className={`text-slate-400 transition-transform duration-200 ${isYearDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`}
                size={16}
              />
            </button>

            {isYearDropdownOpen && (
              <div
                className="absolute right-0 w-40 top-[calc(100%+6px)] z-50 py-1.5 bg-white border border-slate-200/90 rounded-xl shadow-xl max-h-60 overflow-y-auto scrollbar-thin"
                style={{ boxShadow: '0 14px 34px rgba(27,42,65,0.14)' }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedYear('all'); setIsYearDropdownOpen(false); }}
                  className={`w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${selectedYear === 'all'
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
                      className={`w-full text-left px-3.5 py-2 text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${isSelected
                        ? 'bg-[var(--brand-gold)] text-white font-semibold'
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

          <div className="text-sm font-semibold text-slate-500 font-mono pl-1">
            {overallBills.length} {overallBills.length === 1 ? 'Bill' : 'Bills'}
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
              <th className="p-3 text-center">Bills</th>
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
                  <p className="font-lora text-base font-semibold text-slate-500 mb-1">No Records Found</p>
                  <p className="text-xs max-w-sm mx-auto">No sales were recorded matching your search filters.</p>
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
                        {data.bills.length} {data.bills.length === 1 ? 'Bill' : 'Bills'}
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
