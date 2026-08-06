import { useState, useEffect, useMemo } from 'react';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { ExpenseRow, BusinessAccountRow } from '@/lib/api';
import { Calendar, Search, ArrowRight, ArrowLeft, FileText, DollarSign, Landmark, CreditCard } from 'lucide-react';

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
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // Default to all
  const [selectedYear, setSelectedYear] = useState<string>('all'); // Default to all

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

  // Extract unique years from expenses for the filter
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
    // Always guarantee current year is in the list
    years.add(new Date().getFullYear().toString());
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Filtered expenses + filter inputs
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

      // 1. Filter by year if selected
      if (selectedYear !== 'all') {
        if (eYear !== selectedYear) return false;
      }

      // 2. Filter by month if selected
      if (selectedMonth !== 'all') {
        if (eMonth !== selectedMonth) return false;
      }

      // 3. Filter by business account name or code
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

  // Group expenses by business account for the card layout
  const bizCardsData = useMemo(() => {
    const groups: { [bizId: number]: { businessAccount: BusinessAccountRow; expenses: ExpenseRow[]; totalAmount: number } } = {};

    overallExpenses.forEach(e => {
      if (!groups[e.ba_id]) {
        const biz = businessAccounts.find(b => b.ba_id === e.ba_id) ||
          { ba_id: e.ba_id, code: '', name: 'General Expense Account', ac_id: 0, status: 'ACTIVE' as const };
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
    return bizCardsData.find(b => b.businessAccount.ba_id === selectedBizId);
  }, [selectedBizId, bizCardsData]);

  if (selectedBizId != null && activeBizDetails) {
    return (
      <div className="card-white p-6 bg-white border border-slate-200 shadow-sm rounded-xl animate-fadeIn">
        <div className="flex items-center justify-between border-b pb-4 mb-4" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedBizId(null)}
              className="w-10 h-10 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-all shadow-sm hover:scale-105"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h3 className="font-lora font-bold text-lg text-slate-800">
                Expenses for {activeBizDetails.businessAccount.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-inter">
                Overall Summary: {activeBizDetails.expenses.length} Expense Record(s) - Total: {formatCurrency(activeBizDetails.totalAmount)}
              </p>
            </div>
          </div>
          <button
            onClick={() => setSelectedBizId(null)}
            className="text-xs text-amber-600 hover:text-amber-700 font-semibold uppercase tracking-wider transition-colors"
          >
            Back to Accounts
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
                <th className="p-3.5 text-right pr-6">Amount Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeBizDetails.expenses.map(e => (
                <tr key={e.expense_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-3.5 pl-4 font-mono text-slate-600">{e.expense_date.slice(0, 10)}</td>
                  <td className="p-3.5 text-center">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider font-mono">
                      {e.expense_id}
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${e.payment_mode === 'CASH' ? 'bg-green-50 text-green-700 border border-green-200' : isChequeMode(e.payment_mode) ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                      {e.payment_mode === 'CASH' && <DollarSign size={10} />}
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
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      {/* Premium Big and Readable Filter Toolbar */}
      <div className="flex flex-col gap-4 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="col-span-1 md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Search Ledger Title or Code</label>
            <div className="relative">
              <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search by business account name or code..."
                value={nameQuery}
                onChange={e => setNameQuery(e.target.value)}
                className="soleria-input pl-10 py-2.5 w-full text-sm font-semibold bg-slate-50/50 hover:bg-white focus:bg-white transition-all shadow-inner"
              />
            </div>
          </div>

          <div className="col-span-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Filter by Month</label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="soleria-input py-2.5 px-3.5 w-full cursor-pointer text-sm font-semibold bg-white hover:border-[#B08D57] transition-all shadow-sm"
            >
              <option value="all">All Months</option>
              {monthsList.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="col-span-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Filter by Year</label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="soleria-input py-2.5 px-3.5 w-full cursor-pointer text-sm font-semibold bg-white hover:border-[#B08D57] transition-all shadow-sm"
            >
              <option value="all">All Years</option>
              {yearsList.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Overall Records
          </div>
          <div className="text-xs font-bold text-[#B08D57] font-mono">
            {overallExpenses.length} Expense Entry(s)
          </div>
        </div>
      </div>

      {/* Business Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {bizCardsData.length === 0 ? (
          <div className="col-span-full card-white p-12 bg-slate-50/50 border text-center flex flex-col items-center justify-center text-slate-400">
            <Calendar size={48} className="text-slate-300 mb-3" />
            <p className="font-lora text-lg font-semibold text-slate-500 mb-1">No Expenses Found</p>
            <p className="text-sm max-w-sm">No expenses were logged matching your filters.</p>
          </div>
        ) : (
          bizCardsData.map(data => {
            return (
              <div
                key={data.businessAccount.ba_id}
                onClick={() => setSelectedBizId(data.businessAccount.ba_id)}
                className="card-white p-5 bg-white border border-slate-200 cursor-pointer transition-all flex flex-col justify-between hover:shadow-md hover:border-[#B08D57] hover:ring-1 hover:ring-gold-200 rounded-xl"
              >
                <div>
                  <div className="flex items-start justify-between mb-1">
                    <h4 className="font-lora font-bold text-base text-slate-800 line-clamp-1">
                      {data.businessAccount.name}
                    </h4>
                  </div>

                  {data.businessAccount.chart_code === '210001' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 mb-2">
                      Vendor Payment
                    </span>
                  )}

                  <div className="font-mono text-xs text-slate-400 mb-4">Code: {data.businessAccount.code}</div>

                  <div className="text-xs font-semibold text-slate-700 flex justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span>Total Expense:</span>
                    <span className="font-mono text-rose-700">{formatCurrency(data.totalAmount)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-4">
                  <div className="flex items-center gap-1.5 bg-rose-50 text-rose-800 px-2.5 py-1 rounded-full text-xs font-semibold border border-rose-200">
                    <FileText size={13} className="text-rose-600" />
                    <span>{data.expenses.length} {data.expenses.length === 1 ? 'Record' : 'Records'}</span>
                  </div>
                  <span className="text-[#B08D57] font-semibold text-xs flex items-center gap-1 hover:text-amber-700 transition-colors">
                    View Records <ArrowRight size={14} />
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
