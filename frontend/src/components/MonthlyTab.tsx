import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { SaleBillRow, CustomerRow, SubCustomerRow, AddaRow, CityRow } from '@/lib/api';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, Edit2, Printer } from 'lucide-react';

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

  // Selected customer for viewing details
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

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
    if (selectedCustomerId == null) return null;
    return customerCardsData.find(c => c.customer.customer_id === selectedCustomerId);
  }, [selectedCustomerId, customerCardsData]);

  if (selectedCustomerId != null && activeCustomerDetails) {
    return (
      <div className="card-white p-6 bg-white border border-slate-200 shadow-sm rounded-xl animate-fadeIn">
        <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCustomerId(null)}
              className="w-10 h-10 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-all shadow-sm hover:scale-105"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h3 className="font-lora font-bold text-lg text-slate-800">
                Bills for {activeCustomerDetails.customer.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-inter">
                Monthly Summary: {activeCustomerDetails.bills.length} Invoice(s)
              </p>
            </div>
          </div>
          <button
            onClick={() => setSelectedCustomerId(null)}
            className="text-xs text-amber-600 hover:text-amber-700 font-semibold uppercase tracking-wider transition-colors"
          >
            Back to Customers
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
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by customer name..."
              value={nameQuery}
              onChange={e => setNameQuery(e.target.value)}
              className="soleria-input pl-10 py-2 w-full text-sm"
            />
          </div>

          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="soleria-input py-2 cursor-pointer text-sm max-w-[200px]"
          >
            <option value="all">All Months</option>
            {monthsList.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="text-sm font-semibold text-slate-500 font-mono">
          {monthlyBills.length} Bills
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {customerCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
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
                className="card-white p-5 bg-white border border-slate-200 cursor-pointer transition-all flex flex-col justify-between hover:shadow-md hover:border-amber-400 hover:ring-1 hover:ring-amber-200 rounded-xl"
              >
                <div>
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-lora font-bold text-base text-slate-800 line-clamp-1">
                      {data.customer.name} {city !== 'Local' && `(${city.substring(0,3).toUpperCase()})`}
                    </h4>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{city}</span>
                  </div>

                  <div className="font-mono text-xs text-slate-400 mb-4">Code: {data.customer.customer_id}</div>

                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-4">
                  <div className="flex items-center gap-1.5 bg-amber-50 text-amber-800 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-200">
                    <FileText size={13} className="text-amber-600" />
                    <span>{data.bills.length} {data.bills.length === 1 ? 'Bill' : 'Bills'}</span>
                  </div>
                  <span className="text-amber-600 font-semibold text-xs flex items-center gap-1 hover:text-amber-700 transition-colors">
                    View Bills <ArrowRight size={14} />
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
