import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Printer, Search, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

interface KhaataRow {
  date: string;
  type: 'Opening Balance' | 'Sale Bill' | 'Sale Return' | 'Receipt (Jamma)' | 'Commission' | 'Cheque Bounced' | 'Cheque Returned';
  invNo: string;    // system-generated id
  billNo: string;   // manual bill number, '-' for non-bill rows
  narration: string; // free text (blank for cheque rows, which use the 3 sub-columns instead)
  chequeNo?: string;
  chequeDate?: string;
  chequeReceivedDate?: string;
  pairs: number;    // only filled for sale/return rows
  debit: number;  // increases customer receivable
  credit: number; // decreases customer receivable
}

export function ReportKhaataContent() {
  const { state } = useApp();

  const [customerId, setCustomerId] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  // Find selected customer info
  const selectedCustomer = useMemo(() => {
    return state.customers.find(c => c.id === customerId);
  }, [customerId, state.customers]);

  // Helper to format/generate account code
  const getAccountCode = (cust: any) => {
    if (!cust) return '';
    const ba = state.businessAccounts.find(b => b.name === cust.name);
    if (ba) return ba.id;
    // Fallback: use acId + padded customer index
    const idx = state.customers.findIndex(c => c.id === cust.id);
    const suffix = (idx !== -1 ? idx + 1 : 1).toString().padStart(2, '0');
    return `${cust.acId}${suffix}`;
  };

  const filteredCustomers = useMemo(() => {
    if (!accountSearch.trim()) return state.customers;
    const q = accountSearch.toLowerCase();
    return state.customers.filter(c => {
      const code = getAccountCode(c);
      const name = c.name.toLowerCase();
      const mainAc = (state.chartAccounts.find(coa => coa.id === c.acId)?.name || 'CUSTOMERS ACCOUNTS').toLowerCase();
      const city = (state.cities.find(ct => ct.id === c.cityId)?.name || 'General').toLowerCase();
      
      return (
        code.includes(q) ||
        name.includes(q) ||
        mainAc.includes(q) ||
        city.includes(q)
      );
    });
  }, [state.customers, accountSearch, state.chartAccounts, state.cities, state.businessAccounts]);

  const khaataEntries = useMemo(() => {
    if (!customerId) return [];
    const entries: KhaataRow[] = [];

    const deliveryNarration = (subCustomerId: string | null) => {
      if (!subCustomerId) return 'SAME';
      return state.subCustomers.find(sc => sc.id === subCustomerId)?.name || 'SAME';
    };

    // 1. Sale Bills (Debit the Customer)
    state.saleBills.forEach(bill => {
      if (bill.customerId !== customerId || bill.status !== 'Posted') return;
      entries.push({
        date: bill.date,
        type: 'Sale Bill',
        invNo: bill.id,
        billNo: bill.billNo,
        narration: deliveryNarration(bill.subCustomerId),
        pairs: bill.items.reduce((s, it) => s + it.pairs, 0),
        debit: bill.totalValue,
        credit: 0
      });
    });

    // 2. Sale Returns (Credit the Customer)
    state.saleReturns.forEach(ret => {
      if (ret.customerId !== customerId || ret.status !== 'Posted') return;
      const totalCreditVal = ret.items.reduce((s, it) => s + it.value, 0);
      entries.push({
        date: ret.date,
        type: 'Sale Return',
        invNo: ret.id,
        billNo: ret.billNo,
        narration: deliveryNarration(ret.subCustomerId),
        pairs: ret.items.reduce((s, it) => s + it.pairs, 0),
        debit: 0,
        credit: totalCreditVal
      });
    });

    // 3. Receipts / Payments Jamma (Credit the Customer)
    state.receipts.forEach(rec => {
      if (rec.customerId !== customerId) return;
      const isCheque = rec.paymentMode === 'Cheque';
      entries.push({
        date: rec.date,
        type: 'Receipt (Jamma)',
        invNo: rec.id,
        billNo: '-',
        narration: isCheque ? '' : (rec.remarks || rec.details || rec.paymentMode.toUpperCase()),
        chequeNo: isCheque ? rec.chequeNo : undefined,
        chequeDate: isCheque ? rec.chequeDate : undefined,
        chequeReceivedDate: isCheque ? rec.chequeReceivedDate : undefined,
        pairs: 0,
        debit: 0,
        credit: rec.amount
      });

      // 4. Commission — payment-time only, credit side, same as the payment
      if (rec.commission && rec.commission > 0) {
        entries.push({
          date: rec.date,
          type: 'Commission',
          invNo: rec.id,
          billNo: '-',
          narration: 'Commission',
          pairs: 0,
          debit: 0,
          credit: rec.commission
        });
      }

      // 5. Bounce (§13) — the credit above stands on its original date; the
      //    cancellation is a debit dated the bounce, so the customer's due goes
      //    back up without rewriting a statement that was already printed.
      if (rec.chequeStatus === 'BOUNCED' && rec.bouncedDate) {
        entries.push({
          date: rec.bouncedDate,
          type: 'Cheque Bounced',
          invNo: rec.id,
          billNo: '-',
          narration: `Cheque ${rec.chequeNo || ''} bounced — reverses receipt of ${rec.date}`,
          pairs: 0,
          debit: rec.amount + (rec.commission || 0),
          credit: 0
        });
      }

      // 6. Return to sender — same reversal shape as a bounce, distinct wording (we handed the
      //    overdue cheque back voluntarily, not a bank rejection).
      if (rec.chequeStatus === 'RETURNED' && rec.returnedDate) {
        entries.push({
          date: rec.returnedDate,
          type: 'Cheque Returned',
          invNo: rec.id,
          billNo: '-',
          narration: `Cheque ${rec.chequeNo || ''} returned to sender — reverses receipt of ${rec.date}`,
          pairs: 0,
          debit: rec.amount + (rec.commission || 0),
          credit: 0
        });
      }
    });

    // Sort by Date
    entries.sort((a, b) => a.date.localeCompare(b.date));

    return entries;
  }, [customerId, state.saleBills, state.saleReturns, state.receipts, state.subCustomers, state.chequeAllocations]);

  // Compute running balance with date filtering
  const runningKhaata = useMemo(() => {
    let openingBalance = 0;

    // Filter by date
    let beforeEntries = khaataEntries;
    let filtered = khaataEntries;

    if (fromDate) {
      beforeEntries = khaataEntries.filter(e => e.date < fromDate);
      filtered = khaataEntries.filter(e => e.date >= fromDate);
    }
    if (toDate) {
      filtered = filtered.filter(e => e.date <= toDate);
    }

    // Calculate opening balance from entries before fromDate
    openingBalance = beforeEntries.reduce((sum, e) => sum + e.debit - e.credit, 0);

    let balance = openingBalance;

    const finalRows = [
      {
        date: fromDate ? `Before ${fromDate}` : '---',
        type: 'Opening Balance' as const,
        invNo: '-',
        billNo: '-',
        narration: fromDate ? `Opening balance before ${fromDate}` : 'Opening Balance brought forward',
        pairs: 0,
        debit: 0,
        credit: 0,
        balance: openingBalance
      },
      ...filtered.map(e => {
        balance = balance + e.debit - e.credit;
        return {
          ...e,
          balance
        };
      })
    ];

    return finalRows;
  }, [khaataEntries, fromDate, toDate]);

  const khaataTotals = useMemo(() => {
    return khaataEntries.reduce((acc, e) => {
      const inRange = (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate);
      if (!inRange) return acc;
      return { debit: acc.debit + e.debit, credit: acc.credit + e.credit };
    }, { debit: 0, credit: 0 });
  }, [khaataEntries, fromDate, toDate]);

  const handleExportExcel = () => {
    const headers = ['Date', 'Type', 'Inv #', 'Bill #', 'Narration', 'Pairs', 'Debit', 'Credit', 'Balance'];
    const rows = runningKhaata.map(row => [
      row.date, row.type, row.invNo, row.billNo,
      row.chequeNo ? `Cheque ${row.chequeNo} / ${row.chequeDate} / Recv ${row.chequeReceivedDate}` : row.narration,
      row.pairs, row.debit, row.credit, row.balance
    ]);
    exportRowsToExcel(`account-ledger-${selectedCustomer?.name || 'export'}`, headers, rows);
  };

  return (
      <div className="mx-auto" style={{ maxWidth: 1000 }}>
        
        {/* 1. Accounts Directory View (When no customer is selected) */}
        {!customerId ? (
          <>
            {/* Selection Bar / Search & Date filters - data-no-print */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="relative flex-1 min-w-[280px]">
                <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search Account:</span>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by Code, Description, Main Account or City..."
                    value={accountSearch}
                    onChange={e => setAccountSearch(e.target.value)}
                    className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
                  />
                  <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                </div>
              </div>

              {/* Date Filters */}
              <div className="flex items-center gap-3">
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">From Date:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="soleria-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">To Date:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="soleria-input py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* List directory grid of cards */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">Accounts Directory</h3>
                  <p className="text-xs text-slate-500 font-medium">Select an account card below to view its detailed statement ledger.</p>
                </div>
                <div className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                  Total: {filteredCustomers.length} Accounts
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="card-white p-12 text-center text-slate-400 border bg-white">
                  No accounts found matching your search.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCustomers.map(c => {
                    const code = getAccountCode(c);
                    const mainAc = state.chartAccounts.find(coa => coa.id === c.acId)?.name || 'CUSTOMERS ACCOUNTS';
                    const city = state.cities.find(ct => ct.id === c.cityId)?.name || 'General';
                    const initialLetter = c.name.charAt(0).toUpperCase();

                    return (
                      <div
                        key={c.id}
                        onClick={() => setCustomerId(c.id)}
                        className="bg-white border rounded-xl p-5 hover:border-amber-500 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col justify-between group"
                        style={{ borderColor: 'var(--border-color)' }}
                      >
                        <div>
                          {/* Card Top: Code & City badge */}
                          <div className="flex items-center justify-between mb-3.5">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                              Code: {code}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/50 uppercase tracking-wider">
                              {city}
                            </span>
                          </div>

                          {/* Card Middle: Avatar circle + Name */}
                          <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-50 text-slate-600 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-all duration-300 flex-shrink-0">
                              {initialLetter}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-slate-900 group-hover:text-[#B08D57] transition-colors leading-tight text-[15px] truncate">
                                {c.name}
                              </h4>
                              <p className="text-[11px] text-slate-400 font-medium mt-0.5 uppercase tracking-wider truncate">
                                {mainAc}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Card Bottom: Action indicator */}
                        <div className="border-t pt-3 mt-1 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-[#B08D57] transition-colors">
                          <span>View Statement</span>
                          <span className="text-sm font-bold group-hover:translate-x-1 transition-transform">&rarr;</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* 2. Specific Account Statement Ledger View */
          <>
            {/* Navigation / Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCustomerId('')}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-semibold"
                >
                  &larr; Back to Accounts Directory
                </button>
                <div className="text-sm font-semibold text-slate-600">
                  Viewing Ledger: <span className="text-amber-800 font-bold">{selectedCustomer?.name}</span>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <span className="block text-[10px] font-semibold text-slate-500 uppercase">Opening Balance</span>
                  <span className="font-bold font-mono text-sm" style={{ color: 'var(--brand-gold)' }}>
                    {formatCurrency(Math.abs(runningKhaata[0]?.balance || 0))}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">From:</span>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={e => setFromDate(e.target.value)}
                      className="soleria-input py-1 text-xs"
                    />
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-500 uppercase mb-0.5">To:</span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={e => setToDate(e.target.value)}
                      className="soleria-input py-1 text-xs"
                    />
                  </div>
                </div>
                
                <button
                  onClick={() => window.print()}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4"
                >
                  <Printer size={16} /> Print Statement
                </button>
                <button
                  onClick={exportToPDF}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4"
                >
                  <FileDown size={16} /> Export PDF
                </button>
                <button
                  onClick={handleExportExcel}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm self-end h-9 mt-4"
                >
                  <FileSpreadsheet size={16} /> Export Excel
                </button>
                </div>
              </div>
            </div>

            {/* Printable Statement Sheet */}
            <div className="card-white p-6 md:p-8 bg-white border">
              
              {/* Header details */}
              <div className="flex items-center justify-between border-b pb-4 mb-6">
                <div>
                  <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTO ERP</h1>
                  <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Business Accounts Ledger</p>
                </div>
                <div className="text-right">
                  <h2 className="font-lora font-semibold text-lg uppercase">Account Statement (Khaata)</h2>
                  <div className="text-sm font-semibold text-slate-700 mt-1">{selectedCustomer?.name}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    Account ID: {getAccountCode(selectedCustomer)} | City: {state.cities.find(ct => ct.id === selectedCustomer?.cityId)?.name || 'General'}
                  </div>
                  {(fromDate || toDate) && (
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Period: {fromDate || 'Start'} to {toDate || 'End'}
                    </div>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-center">Inv #</th>
                      <th className="p-3 text-center">Bill #</th>
                      <th className="p-3" style={{ minWidth: '220px' }}>Narration</th>
                      <th className="p-3 text-center">Pairs</th>
                      <th className="p-3 text-right">Debit (Dr)</th>
                      <th className="p-3 text-right">Credit (Cr)</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runningKhaata.length === 1 && runningKhaata[0].balance === 0 && runningKhaata[0].debit === 0 && runningKhaata[0].credit === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center p-8 text-slate-400">
                          No ledger entries found matching selection or date range.
                        </td>
                      </tr>
                    ) : (
                      runningKhaata.map((row, idx) => {
                        const displayBal = Math.abs(row.balance);
                        const isRed = row.credit > 0;

                        return (
                          <tr
                            key={idx}
                            className={`border-b ${row.type === 'Opening Balance' ? 'bg-slate-50 font-medium text-slate-700' : isRed ? 'text-rose-700 hover:bg-rose-50/30' : 'text-slate-700 hover:bg-slate-50/30'}`}
                            style={{ borderColor: 'var(--border-table)' }}
                          >
                            <td className="p-3 pl-4 font-semibold">{row.date}</td>
                            <td className="p-3">
                              <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${row.type === 'Sale Bill' ? 'bg-rose-50 text-rose-700' : row.type === 'Receipt (Jamma)' ? 'bg-emerald-50 text-emerald-700' : row.type === 'Sale Return' ? 'bg-blue-50 text-blue-700' : row.type === 'Commission' ? 'bg-amber-50 text-amber-700' : row.type === 'Cheque Bounced' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                                {row.type}
                              </span>
                            </td>
                            <td className="p-3 text-center font-mono text-xs">{row.invNo}</td>
                            <td className="p-3 text-center font-medium">{row.billNo}</td>
                            <td className="p-3 text-xs font-medium">
                              {row.chequeNo ? (
                                <div className="flex flex-col gap-0.5">
                                  <span><span className="text-slate-400">Cheque No:</span> {row.chequeNo}</span>
                                  <span><span className="text-slate-400">Date on Cheque:</span> {row.chequeDate}</span>
                                  <span><span className="text-slate-400">Received:</span> {row.chequeReceivedDate}</span>
                                </div>
                              ) : (
                                row.narration
                              )}
                            </td>
                            <td className="p-3 text-center text-slate-600 font-medium">{row.pairs > 0 ? row.pairs : '-'}</td>
                            <td className="p-3 text-right text-rose-700 font-bold">
                              {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                            </td>
                            <td className="p-3 text-right text-emerald-700 font-bold">
                              {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                            </td>
                            <td className="p-3 text-right font-bold text-slate-800">
                              {formatCurrency(displayBal)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={6} className="p-4 text-left font-lora">TOTAL</td>
                      <td className="p-4 text-right text-rose-800">{formatCurrency(khaataTotals.debit)}</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(khaataTotals.credit)}</td>
                      <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>
                        {formatCurrency(Math.abs(runningKhaata[runningKhaata.length - 1]?.balance || 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}

      </div>
  );
}

export default function ReportKhaataPage() {
  return (
    <AppLayout pageTitle="Accounts Ledger / Khaata">
      <ReportKhaataContent />
    </AppLayout>
  );
}
