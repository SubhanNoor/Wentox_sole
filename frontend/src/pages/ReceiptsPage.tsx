import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { Receipt } from '@/types';
import { Save, Printer, DollarSign, CreditCard, Landmark, FileText } from 'lucide-react';

export default function ReceiptsPage() {
  const { state, dispatch } = useApp();

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Cheque' | 'Online'>('Cash');
  const [details, setDetails] = useState('');
  const [remarks, setRemarks] = useState('');

  // Alerts
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Customer account group helpers
  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  const customerMainAcName = useMemo(() => {
    if (!selectedCustomer) return '';
    return state.chartAccounts.find(a => a.id === selectedCustomer.acId)?.name || 'CUSTOMERS ACCOUNTS';
  }, [selectedCustomer, state.chartAccounts]);

  const handleSaveReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return setErrorMsg('Please pick a date.');
    if (!customerId) return setErrorMsg('Please select a customer.');
    if (amount <= 0) return setErrorMsg('Amount must be greater than 0.');

    const newReceipt: Receipt = {
      id: 'rc_' + Date.now(),
      date,
      customerId,
      amount,
      paymentMode,
      details,
      remarks
    };

    dispatch({ type: 'ADD_RECEIPT', receipt: newReceipt });
    
    setSuccessMsg(`Receipt of ${formatCurrency(amount)} saved successfully against customer!`);
    setTimeout(() => setSuccessMsg(''), 3500);

    // Reset Form
    setAmount(0);
    setDetails('');
    setRemarks('');
    setErrorMsg('');
  };

  return (
    <AppLayout pageTitle="Receipts / Jamma Entry">
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* Banner Alerts */}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          
          {/* Entry Form (Left) */}
          <div className="lg:col-span-2 flex flex-col gap-4" data-no-print>
            <div className="card-white p-5 bg-white border">
              <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
                <DollarSign size={18} className="text-green-600" /> New Receipt (Jamma)
              </h3>
              
              <form onSubmit={handleSaveReceipt} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Receipt Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="soleria-input"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Select Customer</label>
                  <select
                    value={customerId}
                    onChange={e => setCustomerId(e.target.value)}
                    className="soleria-input cursor-pointer"
                  >
                    <option value="">Select customer...</option>
                    {state.customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {selectedCustomer && (
                  <div className="grid grid-cols-2 gap-2 p-2 bg-slate-50 border rounded-md text-xs">
                    <div>
                      <span className="block text-slate-500 font-medium">Customer Code:</span>
                      <span className="font-semibold text-slate-700 font-mono">{selectedCustomer.id}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500 font-medium">Main A/C Group:</span>
                      <span className="font-semibold text-slate-700">{customerMainAcName}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount Received (PKR)</label>
                  <input
                    type="number"
                    min={0}
                    value={amount || ''}
                    onChange={e => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    placeholder="Enter amount in Rs..."
                    className="soleria-input font-semibold font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => { setPaymentMode('Cash'); setDetails(''); }}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Cash' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMode('Cheque')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Cheque' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Cheque
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMode('Online')}
                      className={`py-2 rounded-md transition-colors ${paymentMode === 'Online' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      Online
                    </button>
                  </div>
                </div>

                {paymentMode !== 'Cash' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {paymentMode === 'Cheque' ? 'Cheque No. & Bank Name' : 'Online Reference Code / Details'}
                    </label>
                    <input
                      type="text"
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      placeholder={paymentMode === 'Cheque' ? 'e.g. MCB Cheque No. 982341' : 'e.g. Alfa ref 980124'}
                      className="soleria-input"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                  <textarea
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    placeholder="Enter remarks..."
                    className="soleria-input"
                    rows={2}
                    style={{ resize: 'none' }}
                  />
                </div>

                <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1.5">
                  <Save size={16} /> Save Receipt
                </button>
              </form>
            </div>
          </div>

          {/* Receipts Ledger List (Right) */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="card-white p-5 bg-white border">
              <div className="flex items-center justify-between border-b pb-2 mb-4">
                <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2">
                  <FileText size={18} className="text-slate-600" /> Recent Receipts Ledger
                </h3>
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1 px-3 py-1.5 text-xs" data-no-print>
                  <Printer size={12} /> Print list
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3 text-center">Mode</th>
                      <th className="p-3">Reference/Details</th>
                      <th className="p-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.receipts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center p-8 text-slate-400">
                          No receipts logged yet.
                        </td>
                      </tr>
                    ) : (
                      state.receipts.map(r => {
                        const cust = state.customers.find(c => c.id === r.customerId);
                        return (
                          <tr key={r.id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                            <td className="p-3 pl-4 font-mono whitespace-nowrap">{r.date}</td>
                            <td className="p-3 font-semibold text-slate-700">{cust?.name || 'Walk-in Customer'}</td>
                            <td className="p-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${r.paymentMode === 'Cash' ? 'bg-green-50 text-green-700 border border-green-200' : r.paymentMode === 'Cheque' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                                {r.paymentMode === 'Cash' && <DollarSign size={10} />}
                                {r.paymentMode === 'Cheque' && <Landmark size={10} />}
                                {r.paymentMode === 'Online' && <CreditCard size={10} />}
                                {r.paymentMode}
                              </span>
                            </td>
                            <td className="p-3 text-slate-500 max-w-[150px] truncate" title={r.details || r.remarks}>
                              {r.details || r.remarks || '-'}
                            </td>
                            <td className="p-3 text-right font-semibold font-mono text-emerald-700">
                              {formatCurrency(r.amount)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
