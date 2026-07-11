import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search } from 'lucide-react';

export default function ReportCashBookPage() {
  const { state } = useApp();

  const [activeTab, setActiveTab] = useState<'monthly' | 'overall'>('monthly');
  const [searchQuery, setSearchQuery] = useState('');
  const [specificDate, setSpecificDate] = useState('');
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const filteredTransactions = useMemo(() => {
    let list = [...state.receipts];

    // 1. Filter by tab-specific criteria
    if (activeTab === 'monthly') {
      list = list.filter(r => {
        const d = new Date(r.date);
        return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
      });
    } else {
      // Overall tab: optional filter by specific date
      if (specificDate) {
        list = list.filter(r => r.date === specificDate);
      }
    }

    // 2. Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => {
        const custName = (state.customers.find(c => c.id === r.customerId)?.name || 'Walk-in Client').toLowerCase();
        const voucher = r.id.toLowerCase();
        const details = (r.details || '').toLowerCase();
        const remarks = (r.remarks || '').toLowerCase();
        const mode = r.paymentMode.toLowerCase();
        const dateStr = r.date.toLowerCase();
        return (
          custName.includes(q) ||
          voucher.includes(q) ||
          details.includes(q) ||
          remarks.includes(q) ||
          mode.includes(q) ||
          dateStr.includes(q)
        );
      });
    }

    // Sort by Date
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [state.receipts, activeTab, filterMonth, filterYear, specificDate, searchQuery, state.customers]);

  const totals = useMemo(() => {
    let cash = 0;
    let cheque = 0;
    let online = 0;

    filteredTransactions.forEach(t => {
      if (t.paymentMode === 'Cash') cash += t.amount;
      else if (t.paymentMode === 'Cheque') cheque += t.amount;
      else if (t.paymentMode === 'Online') online += t.amount;
    });

    return { cash, cheque, online, grandTotal: cash + cheque + online };
  }, [filteredTransactions]);

  return (
    <AppLayout pageTitle="Cash Book Summary">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Tab Selector - data-no-print */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl max-w-xs mb-6 border border-slate-200" data-no-print>
          <button
            onClick={() => {
              setActiveTab('monthly');
              setSearchQuery('');
            }}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'monthly' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => {
              setActiveTab('overall');
              setSearchQuery('');
            }}
            className={`flex-1 text-center py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${activeTab === 'overall' ? 'bg-[#111c2a] text-[#B08D57] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            Overall
          </button>
        </div>

        {/* Selection Bar - data-no-print */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
          <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[290px]">
            {/* Search filter for both */}
            <div className="relative flex-1 min-w-[240px]">
              <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Particulars:</span>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by customer, voucher, mode..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                />
                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
              </div>
            </div>

            {/* Tab specific filter */}
            {activeTab === 'monthly' ? (
              <div className="flex items-center gap-2">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Month:</span>
                  <select
                    value={filterMonth}
                    onChange={e => setFilterMonth(parseInt(e.target.value))}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[110px]"
                  >
                    {months.map((m, idx) => (
                      <option key={idx} value={idx}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Year:</span>
                  <select
                    value={filterYear}
                    onChange={e => setFilterYear(parseInt(e.target.value))}
                    className="soleria-input py-1.5 cursor-pointer text-xs min-w-[80px]"
                  >
                    <option value={2026}>2026</option>
                    <option value={2025}>2025</option>
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Specific Date:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={specificDate}
                    onChange={e => setSpecificDate(e.target.value)}
                    className="soleria-input py-1 text-xs"
                  />
                  {specificDate && (
                    <button
                      onClick={() => setSpecificDate('')}
                      className="text-xs font-semibold text-rose-600 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9">
            <Printer size={16} /> Print Cash Book
          </button>
        </div>

        {/* Cash Book Grid */}
        <div className="card-white p-6 md:p-8 bg-white border">
          
          <div className="flex items-center justify-between border-b pb-4 mb-6">
            <div>
              <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
              <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution </p>
            </div>
            <div className="text-right">
              <h2 className="font-lora font-semibold text-lg uppercase">Cash Book Statement</h2>
              <p className="text-sm text-slate-700 mt-1 font-semibold uppercase">
                {activeTab === 'monthly' ? `${months[filterMonth]} ${filterYear}` : 'Overall History'}
              </p>
              {activeTab === 'overall' && specificDate && (
                <p className="text-xs text-amber-700 font-bold">Filtered Date: {specificDate}</p>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6" data-no-print>
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Cash Receipts</span>
              <span className="text-lg font-bold text-slate-800">{formatCurrency(totals.cash)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Cheques Logged</span>
              <span className="text-lg font-bold text-slate-800">{formatCurrency(totals.cheque)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: 'var(--border-color)' }}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Online Deposits</span>
              <span className="text-lg font-bold text-slate-800">{formatCurrency(totals.online)}</span>
            </div>
            <div className="p-4 rounded-xl border bg-[#111c2a]" style={{ borderColor: '#B08D57' }}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">Total Inflow</span>
              <span className="text-xl font-bold text-[#B08D57]">{formatCurrency(totals.grandTotal)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Date</th>
                  <th className="p-3 text-center">Ref Voucher</th>
                  <th className="p-3">Particulars / Customer</th>
                  <th className="p-3">Mode</th>
                  <th className="p-3">Reference/Details</th>
                  <th className="p-3 text-right">Debit (Inflow)</th>
                  <th className="p-3 text-right">Credit (Outflow)</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-400">
                      No cash transactions registered for this selection.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map(trans => {
                    const cust = state.customers.find(c => c.id === trans.customerId);
                    return (
                      <tr key={trans.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-semibold text-slate-700">{trans.date}</td>
                        <td className="p-3 text-center font-semibold text-slate-600">{trans.id.substring(3, 9)}</td>
                        <td className="p-3 font-semibold text-slate-800">{cust?.name || 'Walk-in Client'}</td>
                        <td className="p-3">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border">
                            {trans.paymentMode}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-500">{trans.details || trans.remarks || '-'}</td>
                        <td className="p-3 text-right font-bold text-slate-800">
                          {formatCurrency(trans.amount)}
                        </td>
                        <td className="p-3 text-right text-slate-400">
                          -
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 border-b text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={5} className="p-4 text-left font-lora">GRAND TOTAL CASH BOOK</td>
                  <td className="p-4 text-right text-slate-800 text-lg">
                    {formatCurrency(totals.grandTotal)}
                  </td>
                  <td className="p-4 text-right text-slate-500">
                    Rs 0
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
