import { useState, useMemo } from 'react';
import { useApp, formatCurrency, isDateInCurrentWeek } from '@/context/AppContext';
import type { Receipt, Customer } from '@/types';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard } from 'lucide-react';

export default function WeeklyReceiptsTab() {
  const { state } = useApp();

  // Filters
  const [nameQuery, setNameQuery] = useState('');

  // Selected customer for viewing details & Exit Animation State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleBack = () => {
    setIsClosing(true);
    setTimeout(() => {
      setSelectedCustomerId(null);
      setIsClosing(false);
    }, 200);
  };

  // Filtered receipts for the current week + filter inputs
  const weeklyReceipts = useMemo(() => {
    return state.receipts.filter(r => {
      if (!isDateInCurrentWeek(r.date)) return false;

      if (nameQuery.trim()) {
        const cust = state.customers.find(c => c.id === r.customerId);
        const custName = cust?.name.toLowerCase() || '';
        const custCode = cust?.id.toLowerCase() || '';
        const query = nameQuery.toLowerCase();
        if (!custName.includes(query) && !custCode.includes(query)) return false;
      }

      return true;
    });
  }, [state.receipts, state.customers, nameQuery]);

  // Group receipts by customer for the card layout
  const customerCardsData = useMemo(() => {
    const groups: { [customerId: string]: { customer: Customer; receipts: Receipt[]; totalAmount: number } } = {};

    weeklyReceipts.forEach(r => {
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
  }, [weeklyReceipts, state.customers]);

  const activeCustomerDetails = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customerCardsData.find(c => c.customer.id === selectedCustomerId);
  }, [selectedCustomerId, customerCardsData]);

  if (selectedCustomerId && activeCustomerDetails) {
    return (
      <div className={`mx-auto px-2 transition-all duration-200 ${
        isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'
      }`} style={{ maxWidth: 1400 }}>
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
                  Receipts for {activeCustomerDetails.customer.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-inter">
                  Weekly Summary: {activeCustomerDetails.receipts.length} Receipt Record(s) - Total: <span className="font-mono font-bold text-amber-800">{formatCurrency(activeCustomerDetails.totalAmount)}</span>
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
                  <th className="p-3.5 text-center">Receipt ID</th>
                  <th className="p-3.5">Payment Mode</th>
                  <th className="p-3.5">Reference / Cheque #</th>
                  <th className="p-3.5">Remarks</th>
                  <th className="p-3.5 text-right pr-4">Amount Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {activeCustomerDetails.receipts.map(rec => {
                  let ModeIcon = DollarSign;
                  let modeBg = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                  if (rec.paymentMode === 'Bank Transfer') {
                    ModeIcon = Landmark;
                    modeBg = 'bg-blue-50 text-blue-700 border-blue-200';
                  } else if (rec.paymentMode === 'Cheque') {
                    ModeIcon = CreditCard;
                    modeBg = 'bg-purple-50 text-purple-700 border-purple-200';
                  }

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3.5 pl-4 font-mono text-slate-600">{rec.date}</td>
                      <td className="p-3.5 text-center">
                        <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wider font-mono">
                          {rec.id}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${modeBg}`}>
                          <ModeIcon size={12} />
                          {rec.paymentMode}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-xs text-slate-700">
                        {rec.referenceNo || rec.chequeNo || <span className="text-slate-400 italic">None</span>}
                      </td>
                      <td className="p-3.5 text-xs text-slate-500 max-w-xs truncate">
                        {rec.remarks || <span className="text-slate-400 italic">-</span>}
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-emerald-700 text-base pr-4">
                        {formatCurrency(rec.amount)}
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
    <div className="mx-auto px-2" style={{ maxWidth: 1400 }}>
      {/* Filter Toolbar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs" style={{ borderColor: 'var(--border-color)' }}>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 text-slate-400" size={17} />
          <input
            type="text"
            placeholder="Search by customer name or code..."
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            className="soleria-input pl-10 py-2 w-full text-sm font-medium"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold text-emerald-900 bg-emerald-50/90 border border-emerald-200/70 px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-2xs">
            <FileText size={14} className="text-emerald-600" />
            <span>{weeklyReceipts.length} Receipt Records</span>
          </div>
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {customerCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border border-slate-200 rounded-2xl text-center flex flex-col items-center justify-center text-slate-400">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-bold text-slate-600 mb-1">No Weekly Receipts Found</p>
            <p className="text-sm max-w-sm">No payment receipts were recorded for this week matching your filters.</p>
          </div>
        ) : (
          customerCardsData.map(data => {
            const city = state.cities.find(c => c.id === data.customer.cityId)?.name || 'Local';

            return (
              <div
                key={data.customer.id}
                onClick={() => setSelectedCustomerId(data.customer.id)}
                className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors line-clamp-1">
                      {data.customer.name}
                    </h4>
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0">
                      {city}
                    </span>
                  </div>

                  <div className="font-mono text-xs text-slate-400 mb-2">
                    Customer ID: <span className="font-semibold text-slate-600">#{data.customer.id}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-2">
                  <div className="flex items-center gap-1.5 bg-emerald-50/90 text-emerald-900 px-3 py-1 rounded-full text-xs font-semibold border border-emerald-200/70">
                    <FileText size={13} className="text-emerald-600" />
                    <span>{data.receipts.length} {data.receipts.length === 1 ? 'Receipt' : 'Receipts'}</span>
                  </div>
                  <span className="text-amber-700 font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
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
