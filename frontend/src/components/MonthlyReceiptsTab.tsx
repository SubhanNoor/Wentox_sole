import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import type { Receipt, Customer } from '@/types';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard } from 'lucide-react';

export default function MonthlyReceiptsTab() {
  const { state } = useApp();

  // Filters
  const [nameQuery, setNameQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().getMonth().toString()); // Default to current month

  // Selected customer for viewing details
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

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

  // Filtered receipts for the selected month + filter inputs
  const monthlyReceipts = useMemo(() => {
    return state.receipts.filter(r => {
      const d = new Date(r.date);
      
      // 1. Must match selected month
      if (selectedMonth !== 'all') {
        const rMonth = d.getMonth().toString();
        if (rMonth !== selectedMonth) return false;
      }

      // 2. Filter by customer name or code
      if (nameQuery.trim()) {
        const cust = state.customers.find(c => c.id === r.customerId);
        const custName = cust?.name.toLowerCase() || '';
        const custCode = cust?.id.toLowerCase() || '';
        const query = nameQuery.toLowerCase();
        if (!custName.includes(query) && !custCode.includes(query)) return false;
      }

      return true;
    });
  }, [state.receipts, state.customers, selectedMonth, nameQuery]);

  // Group receipts by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: string]: { customer: Customer; receipts: Receipt[]; totalAmount: number } } = {};

    monthlyReceipts.forEach(r => {
      if (!groups[r.customerId]) {
        const cust = state.customers.find(c => c.id === r.customerId) || { id: r.customerId, name: 'Walk-in Customer', acId: '', regionId: '', cityId: '' };
        groups[r.customerId] = {
          customer: cust,
          receipts: [],
          totalAmount: 0
        };
      }
      
      const grp = groups[r.customerId];
      grp.receipts.push(r);
      grp.totalAmount += r.amount;
    });

    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [monthlyReceipts, state.customers]);

  const activeCustomerDetails = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customerCardsData.find(c => c.customer.id === selectedCustomerId);
  }, [selectedCustomerId, customerCardsData]);

  if (selectedCustomerId && activeCustomerDetails) {
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
                Receipts for {activeCustomerDetails.customer.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-inter">
                Monthly Summary: {activeCustomerDetails.receipts.length} Receipt Record(s) - Total: {formatCurrency(activeCustomerDetails.totalAmount)}
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
                <th className="p-3.5 text-center">Mode</th>
                <th className="p-3.5">Reference/Details</th>
                <th className="p-3.5">Remarks</th>
                <th className="p-3.5 text-right pr-6">Amount Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeCustomerDetails.receipts.map(r => (
                <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{r.date}</td>
                  <td className="p-3.5 text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                      {r.id.replace('rc_', '')}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${r.paymentMode === 'Cash' ? 'bg-green-50 text-green-700 border border-green-200' : r.paymentMode === 'Cheque' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                      {r.paymentMode === 'Cash' && <DollarSign size={10} />}
                      {r.paymentMode === 'Cheque' && <Landmark size={10} />}
                      {r.paymentMode === 'Online' && <CreditCard size={10} />}
                      {r.paymentMode}
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
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by customer name or code..."
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
          {monthlyReceipts.length} Receipt Records
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {customerCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Monthly Receipts Found</p>
            <p className="text-sm max-w-sm">No receipts were logged for this month matching your filters.</p>
          </div>
        ) : (
          customerCardsData.map(data => {
            const city = state.cities.find(c => c.id === data.customer.cityId)?.name || 'Local';
            
            return (
              <div
                key={data.customer.id}
                onClick={() => setSelectedCustomerId(data.customer.id)}
                className="card-white p-5 bg-white border border-slate-200 cursor-pointer transition-all flex flex-col justify-between hover:shadow-md hover:border-amber-400 hover:ring-1 hover:ring-amber-200 rounded-xl"
              >
                <div>
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-lora font-bold text-base text-slate-800 line-clamp-1">
                      {data.customer.name} {city !== 'Local' && `(${city.substring(0,3).toUpperCase()})`}
                    </h4>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{city}</span>
                  </div>
                  
                  <div className="font-mono text-xs text-slate-400 mb-4">Code: {data.customer.id}</div>
                  
                  <div className="text-xs font-semibold text-slate-700 flex justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span>Total Jamma:</span>
                    <span className="font-mono text-emerald-700">{formatCurrency(data.totalAmount)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-4">
                  <div className="flex items-center gap-1.5 bg-amber-50 text-amber-800 px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-200">
                    <FileText size={13} className="text-amber-600" />
                    <span>{data.receipts.length} {data.receipts.length === 1 ? 'Receipt' : 'Receipts'}</span>
                  </div>
                  <span className="text-amber-600 font-semibold text-xs flex items-center gap-1 hover:text-amber-700 transition-colors">
                    View Receipts <ArrowRight size={14} />
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
