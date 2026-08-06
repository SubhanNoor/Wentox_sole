import { useState, useMemo } from 'react';
import { useApp, formatCurrency, isDateInCurrentWeek } from '@/context/AppContext';
import type { Expense, BusinessAccount } from '@/types';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard } from 'lucide-react';
import { isChequeMode, expenseModeLabel } from '@/lib/cashbank';


export default function WeeklyExpensesTab() {
  const { state } = useApp();

  const [nameQuery, setNameQuery] = useState('');
  const [selectedBizId, setSelectedBizId] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const handleBack = () => {
    setIsClosing(true);
    setTimeout(() => {
      setSelectedBizId(null);
      setIsClosing(false);
    }, 200);
  };

  const weeklyExpenses = useMemo(() => {
    return state.expenses.filter(e => {
      if (!isDateInCurrentWeek(e.date)) return false;
      if (nameQuery.trim()) {
        const biz = state.businessAccounts.find(b => b.id === e.businessAccountId);
        const bizName = biz?.name.toLowerCase() || '';
        const bizCode = biz?.id.toLowerCase() || '';
        const query = nameQuery.toLowerCase();
        if (!bizName.includes(query) && !bizCode.includes(query)) return false;
      }
      return true;
    });
  }, [state.expenses, state.businessAccounts, nameQuery]);

  const bizCardsData = useMemo(() => {
    const groups: { [bizId: string]: { businessAccount: BusinessAccount; expenses: Expense[]; totalAmount: number } } = {};
    weeklyExpenses.forEach(e => {
      if (!groups[e.businessAccountId]) {
        const biz = state.businessAccounts.find(b => b.id === e.businessAccountId) || {
          id: e.businessAccountId,
          name: 'General Expense Account',
          controlId: '', linkCode: '', region: 'LOCAL', status: 'Active' as const
        };
        groups[e.businessAccountId] = { businessAccount: biz, expenses: [], totalAmount: 0 };
      }
      groups[e.businessAccountId].expenses.push(e);
      groups[e.businessAccountId].totalAmount += e.amount;
    });
    return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [weeklyExpenses, state.businessAccounts]);

  const activeBizDetails = useMemo(() => {
    if (!selectedBizId) return null;
    return bizCardsData.find(b => b.businessAccount.id === selectedBizId);
  }, [selectedBizId, bizCardsData]);

  if (selectedBizId && activeBizDetails) {
    return (
      <div className={`card-white p-6 bg-white border border-slate-200/80 shadow-md rounded-2xl transition-all duration-200 ${
        isClosing ? 'opacity-0 translate-y-2 scale-98' : 'animate-in fade-in slide-in-from-bottom-3 duration-300'
      }`}>
        <div className="flex items-center justify-between border-b pb-4 mb-5" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="w-10 h-10 rounded-full border border-slate-200/80 hover:bg-slate-50 text-slate-600 flex items-center justify-center shadow-2xs hover:scale-105 cursor-pointer transition-all"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h3 className="font-lora font-bold text-xl text-slate-900">
                Expenses for {activeBizDetails.businessAccount.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-inter">
                Weekly Summary: {activeBizDetails.expenses.length} Expense Record(s) — Total:{' '}
                <span className="font-mono font-bold text-amber-800">{formatCurrency(activeBizDetails.totalAmount)}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50/80 hover:bg-amber-100/90 text-amber-900 border border-amber-200/80 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs hover:shadow-xs cursor-pointer hover:-translate-x-0.5"
          >
            <ArrowLeft size={14} className="text-amber-700" />
            <span>Back to Accounts</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full text-left border-collapse text-sm font-inter">
            <thead>
              <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500 border-slate-200">
                <th className="p-3.5 pl-4">Date</th>
                <th className="p-3.5 text-center">Sys ID</th>
                <th className="p-3.5 text-center">Mode</th>
                <th className="p-3.5">Reference / Details</th>
                <th className="p-3.5">Remarks</th>
                <th className="p-3.5 text-right pr-6">Amount Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeBizDetails.expenses.map(e => (
                <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{e.date}</td>
                  <td className="p-3.5 text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                      {e.id.replace('exp_', '')}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${e.paymentMode === 'Cash' ? 'bg-green-50 text-green-700 border border-green-200' : isChequeMode(e.paymentMode) ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                      {e.paymentMode === 'Cash' && <DollarSign size={10} />}
                      {isChequeMode(e.paymentMode) && <Landmark size={10} />}
                      {e.paymentMode === 'Online' && <CreditCard size={10} />}
                      {expenseModeLabel(e.paymentMode)}
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
    <div className="mx-auto px-2" style={{ maxWidth: 1400 }}>
      {/* Filter Toolbar */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white shadow-2xs" style={{ borderColor: 'var(--border-color)' }}>
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3.5 top-2.5 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search by account name or code..."
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            className="soleria-input pl-10 py-2 w-full text-sm font-semibold bg-slate-50/50 hover:bg-white focus:bg-white transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-[var(--brand-gold)] bg-amber-50 border border-amber-200/80 px-3 py-1.5 rounded-full font-mono whitespace-nowrap">
            {bizCardsData.length} Account(s)
          </span>
        </div>
      </div>

      {/* Business Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bizCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Weekly Expenses Found</p>
            <p className="text-sm max-w-sm">No expenses were logged for this week matching your filters.</p>
          </div>
        ) : (
          bizCardsData.map(data => (
            <div
              key={data.businessAccount.id}
              onClick={() => setSelectedBizId(data.businessAccount.id)}
              className="group relative bg-white p-6 rounded-2xl border border-slate-200/80 cursor-pointer transition-all duration-300 transform hover:-translate-y-1.5 hover:border-[var(--brand-gold)] hover:ring-1 hover:ring-[var(--brand-gold)] hover:shadow-[0_16px_36px_rgba(176,141,87,0.18)] flex flex-col justify-between min-h-[190px]"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h4 className="font-lora font-bold text-lg text-slate-900 group-hover:text-[var(--brand-navy)] transition-colors line-clamp-1">
                    {data.businessAccount.name}
                  </h4>
                  <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200/60 uppercase tracking-wider flex-shrink-0">
                    {data.businessAccount.region}
                  </span>
                </div>

                {data.businessAccount.controlId === '210001' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 mb-1.5">
                    Vendor Payment
                  </span>
                )}

                <div className="font-mono text-xs text-slate-400 mb-2">Code: <span className="font-semibold text-slate-600">{data.businessAccount.id}</span></div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3.5 mt-3">
                <div className="flex items-center gap-1.5 bg-rose-50/90 text-rose-800 px-3 py-1 rounded-full text-xs font-semibold border border-rose-200/70">
                  <FileText size={13} className="text-rose-600" />
                  <span>{data.expenses.length} {data.expenses.length === 1 ? 'Record' : 'Records'}</span>
                </div>
                <span className="text-amber-700 font-semibold text-xs flex items-center gap-1.5 group-hover:text-[var(--brand-navy)] transition-colors">
                  View Records <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
