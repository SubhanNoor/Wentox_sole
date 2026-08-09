import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleBillRow, CustomerRow, SubCustomerRow, AddaRow, CityRow } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, Edit2, Printer } from 'lucide-react';

interface WeeklyTabProps {
  onEditBill: (bill: SaleBillRow) => void;
  onPrintBill: (bill: SaleBillRow) => void;
}

export default function WeeklyTab({ onEditBill, onPrintBill }: WeeklyTabProps) {
  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [subCustomers, setSubCustomers] = useState<SubCustomerRow[]>([]);
  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [cities, setCities] = useState<CityRow[]>([]);

  useEffect(() => {
    (async () => {
      const [b, c, sc, ad, ct] = await Promise.all([
        api.saleBills.list({ range: 'weekly' }),
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

  // Client-side post-filter over the fetched (already weekly-scoped) bills
  const weeklyBills = useMemo(() => {
    return bills.filter(bill => {
      if (nameQuery.trim()) {
        const custName = customers.find(c => c.customer_id === bill.customer_id)?.name.toLowerCase() || '';
        if (!custName.includes(nameQuery.toLowerCase())) return false;
      }

      return true;
    });
  }, [bills, customers, nameQuery]);

  // Group bills by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: number]: { customer: CustomerRow; bills: SaleBillRow[]; totalCartons: number; totalPairs: number; totalValue: number } } = {};

    weeklyBills.forEach(bill => {
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
  }, [weeklyBills, customers]);

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
                Weekly Summary: {activeCustomerDetails.bills.length} Invoice(s)
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

        <div className="text-sm font-semibold text-slate-500 font-mono">
          {weeklyBills.length} {weeklyBills.length === 1 ? 'Bill' : 'Bills'}
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {customerCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400 rounded-2xl">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Weekly Records Found</p>
            <p className="text-sm max-w-sm">No sales were recorded for this week matching your filters.</p>
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
