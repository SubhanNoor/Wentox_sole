import { useState, useEffect, useMemo, useRef } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleBillRow, CustomerRow, SubCustomerRow, AddaRow, CityRow } from '@/lib/api';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, Edit2, Printer, ChevronDown, Check } from 'lucide-react';

interface MonthlyTabProps {
  onEditBill: (bill: SaleBillRow) => void;
  onPrintBill: (bill: SaleBillRow) => void;
}

export default function MonthlyTab({ onEditBill, onPrintBill }: MonthlyTabProps) {
  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  useEffect(() => {
    (async () => {
      const [b, c, sc, ad, ct] = await Promise.all([
        api.saleBills.list({ range: 'monthly' }),
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
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().getMonth().toString()); // Default to current month
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false);
  const monthDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (monthDropdownRef.current && !monthDropdownRef.current.contains(e.target as Node)) {
        setIsMonthDropdownOpen(false);
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

  // Client-side post-filter over the fetched (already monthly-scoped) bills
  const monthlyBills = useMemo(() => {
    return bills.filter(bill => {
      const d = new Date(bill.bill_date);

      if (selectedMonth !== 'all') {
        const billMonth = d.getMonth().toString();
        if (billMonth !== selectedMonth) return false;
      }

      if (nameQuery.trim()) {
        const custName = customers.find(c => c.customer_id === bill.customer_id)?.name.toLowerCase() || '';
        if (!custName.includes(nameQuery.toLowerCase())) return false;
      }

      return true;
    });
  }, [bills, customers, selectedMonth, nameQuery]);

  // Group bills by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: number]: { customer: CustomerRow; bills: SaleBillRow[]; totalCartons: number; totalPairs: number; totalValue: number } } = {};

    monthlyBills.forEach(bill => {
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
  }, [monthlyBills, customers]);

  const activeCustomerDetails = useMemo(() => {
    if (selectedCustomerId === null) return null;
    return customerCardsData.find(d => d.customer.customer_id === selectedCustomerId) || null;
  }, [customerCardsData, selectedCustomerId]);

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
                Monthly Summary: {activeCustomerDetails.bills.length} Invoice(s)
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
                    <td className="p-3.5 pl-4 font-mono text-slate-600">{bill.bill_date.slice(0, 10)}</td>
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
                    <td className="p-3.5 text-center font-mono font-semibold text-slate-700">{billCartons}</td>
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
    <div className="mx-auto px-2" style={{ maxWidth: 1400 }}>
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

        <div className="flex items-center gap-4">
          {/* Custom Brand Month Dropdown Menu */}
          <div className="relative min-w-[170px]" ref={monthDropdownRef}>
            <button
              type="button"
              onClick={() => setIsMonthDropdownOpen(!isMonthDropdownOpen)}
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

          <div className="text-sm font-semibold text-slate-500 font-mono">
            {monthlyBills.length} {monthlyBills.length === 1 ? 'Bill' : 'Bills'}
          </div>
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {customerCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400 rounded-2xl">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Monthly Records Found</p>
            <p className="text-sm max-w-sm">No sales were recorded for this month matching your filters.</p>
          </div>
        ) : (
          customerCardsData.map(data => {
            const city = cities.find(c => c.city_id === data.customer.city_id)?.name || 'Local';

            return (
              <div
                key={data.customer.customer_id}
                onClick={() => setSelectedCustomerId(data.customer.customer_id)}
                className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
              >
                <div>
                  {/* Header: Name + City Badge */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors line-clamp-1">
                      {data.customer.name}
                    </h4>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0">
                      {city}
                    </span>
                  </div>

                  {/* Customer Code */}
                  <div className="font-mono text-xs text-slate-400 mb-2">
                    Customer ID: <span className="font-semibold text-slate-600">#{data.customer.customer_id}</span>
                  </div>
                </div>

                {/* Footer Bar */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-2">
                  <div className="flex items-center gap-1.5 bg-amber-50/90 text-amber-900 px-3 py-1 rounded-full text-xs font-semibold border border-amber-200/70">
                    <FileText size={13} className="text-amber-600" />
                    <span>{data.bills.length} {data.bills.length === 1 ? 'Bill' : 'Bills'}</span>
                  </div>
                  <span className="text-amber-700 font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                    View Details <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
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
