import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import { getTodayDate, getThreeMonthsAgoDate, formatDate } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/export';
import { Eye, Search } from 'lucide-react';
import * as api from '@/lib/api';
import type { ChequeRow, IssuedChequeRow, ChequeAllocationRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

// Every event a cheque's life can produce — a small fixed enum, so distinct colors per event
// (same spirit as ChequesTab.tsx's own STATUS_STYLES) don't run into the "badge color from
// arbitrary text" issue fixed elsewhere (Overall Search, Current Stock).
type EventType = 'Received' | 'Issued' | 'Deposited' | 'Endorsed to Vendor' | 'Endorsed to Expense' | 'Bounced' | 'Returned';

const EVENT_STYLES: Record<EventType, string> = {
  Received: 'bg-slate-100 text-slate-700 border-slate-300',
  Issued: 'bg-slate-100 text-slate-700 border-slate-300',
  Deposited: 'bg-blue-50 text-blue-700 border-blue-200',
  'Endorsed to Vendor': 'bg-violet-50 text-violet-700 border-violet-200',
  'Endorsed to Expense': 'bg-violet-50 text-violet-700 border-violet-200',
  Bounced: 'bg-rose-50 text-rose-700 border-rose-200',
  Returned: 'bg-orange-50 text-orange-700 border-orange-200',
};

// One row per EVENT, not per cheque — an endorsement stays on the ledger even after it's later
// reversed (marked, not removed), and the reversal itself shows as its own additional row, same
// "reverse-never-delete/hide" philosophy as Overall Trail and every other ledger in this app.
interface LedgerEvent {
  key: string;
  chequeType: 'Received' | 'Issued';
  chequeNo: string;
  date: string;
  eventType: EventType;
  party: string;
  bank: string;
  amount: number;
  reversed: boolean;
}

function receivedEvents(c: ChequeRow, allocations: ChequeAllocationRow[]): LedgerEvent[] {
  const events: LedgerEvent[] = [{
    key: `received-${c.cheque_id}-received`,
    chequeType: 'Received',
    chequeNo: c.cheque_no,
    date: c.cheque_date,
    eventType: 'Received',
    party: c.customer_name || c.account_name || '-',
    bank: '-',
    amount: c.receipt_amount || 0,
    reversed: false,
  }];

  for (const a of allocations) {
    const eventType: EventType = a.disposition_type === 'DEPOSIT' ? 'Deposited'
      : a.disposition_type === 'VENDOR_PAYMENT' ? 'Endorsed to Vendor'
      : 'Endorsed to Expense';
    events.push({
      key: `received-${c.cheque_id}-alloc-${a.allocation_id}`,
      chequeType: 'Received',
      chequeNo: c.cheque_no,
      date: a.allocation_date,
      eventType,
      party: a.vendor_name || a.target_name || '-',
      bank: a.disposition_type === 'DEPOSIT' ? (c.bank_name || '-') : '-',
      amount: a.amount,
      reversed: a.status === 'REVERSED',
    });
  }

  if (c.bounced_date) {
    events.push({
      key: `received-${c.cheque_id}-bounced`, chequeType: 'Received', chequeNo: c.cheque_no,
      date: c.bounced_date, eventType: 'Bounced', party: c.customer_name || '-', bank: '-',
      amount: c.receipt_amount || 0, reversed: false,
    });
  }
  if (c.returned_date) {
    events.push({
      key: `received-${c.cheque_id}-returned`, chequeType: 'Received', chequeNo: c.cheque_no,
      date: c.returned_date, eventType: 'Returned', party: c.customer_name || '-', bank: '-',
      amount: c.receipt_amount || 0, reversed: false,
    });
  }
  return events;
}

// Issued cheques don't have DEPOSITED/PARTIALLY_ENDORSED events (a cheque we write is deducted
// from our bank the moment it's posted, see expenses.repository.js's payment_mode comment) — only
// Issued/Bounced/Returned apply.
function issuedEvents(e: IssuedChequeRow): LedgerEvent[] {
  const events: LedgerEvent[] = [{
    key: `issued-${e.expense_id}-issued`,
    chequeType: 'Issued',
    chequeNo: e.issued_cheque_no || '-',
    date: e.issued_cheque_date || e.expense_date,
    eventType: 'Issued',
    party: e.ba_name || '-',
    bank: e.bank_name || '-',
    amount: e.amount,
    reversed: false,
  }];
  if (e.issued_cheque_bounced_date) {
    events.push({
      key: `issued-${e.expense_id}-bounced`, chequeType: 'Issued', chequeNo: e.issued_cheque_no || '-',
      date: e.issued_cheque_bounced_date, eventType: 'Bounced', party: e.ba_name || '-',
      bank: e.bank_name || '-', amount: e.amount, reversed: false,
    });
  }
  if (e.issued_cheque_returned_date) {
    events.push({
      key: `issued-${e.expense_id}-returned`, chequeType: 'Issued', chequeNo: e.issued_cheque_no || '-',
      date: e.issued_cheque_returned_date, eventType: 'Returned', party: e.ba_name || '-',
      bank: e.bank_name || '-', amount: e.amount, reversed: false,
    });
  }
  return events;
}

export function ChequeLedgerContent() {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'received' | 'issued'>('all');
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [receivedRes, issuedRes] = await Promise.all([
        api.cheques.list({ date_from: fromDate || undefined, date_to: toDate || undefined }),
        api.expenses.issuedCheques({ date_from: fromDate || undefined, date_to: toDate || undefined }),
      ]);

      let receivedEvts: LedgerEvent[] = [];
      if (receivedRes.ok) {
        // Every received cheque's own allocation history (deposits/endorsements, active or
        // reversed) — not just the ones still open, unlike Cheque in Hand/Disposal's default filter.
        const perCheque = await Promise.all(receivedRes.data.map(async (c) => {
          const allocRes = await api.cheques.allocationsForReceipt(c.receipt_id);
          return receivedEvents(c, allocRes.ok ? allocRes.data : []);
        }));
        receivedEvts = perCheque.flat();
      } else {
        setErrorMsg('Failed to load received cheques: ' + receivedRes.error.message);
      }

      let issuedEvts: LedgerEvent[] = [];
      if (issuedRes.ok) {
        issuedEvts = issuedRes.data.flatMap(issuedEvents);
      } else {
        setErrorMsg(prev => prev || 'Failed to load issued cheques: ' + issuedRes.error.message);
      }

      setEvents([...receivedEvts, ...issuedEvts]);
    } catch (err) {
      // A rejected IPC call would otherwise leave loading stuck true forever with no feedback.
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load the cheque ledger.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const ledgerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter(r => typeFilter === 'all' || (typeFilter === 'received' ? r.chequeType === 'Received' : r.chequeType === 'Issued'))
      .filter(r => !q || r.chequeNo.toLowerCase().includes(q) || r.party.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [events, typeFilter, search]);

  const totals = useMemo(() => {
    const totalAmount = ledgerRows.reduce((s, r) => s + r.amount, 0);
    const totalReceived = ledgerRows.filter(r => r.chequeType === 'Received').reduce((s, r) => s + r.amount, 0);
    const totalIssued = ledgerRows.filter(r => r.chequeType === 'Issued').reduce((s, r) => s + r.amount, 0);
    return { totalAmount, totalReceived, totalIssued };
  }, [ledgerRows]);

  const handleExportExcel = () => {
    const headers = ['Type', 'Cheque No.', 'Date', 'Event', 'Party', 'Bank', 'Amount', 'Reversed'];
    const rows = ledgerRows.map(r => [
      r.chequeType, r.chequeNo, formatDate(r.date), r.eventType, r.party, r.bank, r.amount, r.reversed ? 'Yes' : '-'
    ]);
    exportRowsToExcel('cheque-ledger', headers, rows);
  };

  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>CHEQUE LEDGER</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
            Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
          </p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>Date of Print: {formatDate(new Date())}</p>
        </div>
      </div>

      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Type</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Cheque No.</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Event</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Party</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Bank</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Amount</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Reversed</th>
          </tr>
        </thead>
        <tbody>
          {ledgerRows.length === 0 ? (
            <tr><td colSpan={8} style={{ border: '1px solid #000000', padding: '12px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>No cheque events found.</td></tr>
          ) : ledgerRows.map(r => (
            <tr key={r.key}>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontWeight: 'bold' }}>{r.chequeType}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace' }}>{r.chequeNo}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{formatDate(r.date)}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{r.eventType}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{r.party}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px' }}>{r.bank}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(r.amount)}</td>
              <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', color: r.reversed ? '#cc0000' : '#888' }}>{r.reversed ? 'REVERSED' : '-'}</td>
            </tr>
          ))}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
            <td colSpan={6} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>TOTAL ({ledgerRows.length} events)</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totals.totalAmount)}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '10px' }}>
              R: {formatCurrency(totals.totalReceived)} / I: {formatCurrency(totals.totalIssued)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Prepared By</span>
        </div>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Audited By</span>
        </div>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Authorized Sign</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1200 }}>
      {errorMsg && (
        <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white"
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
            <button onClick={() => setTypeFilter('all')} className={`px-3 py-2 rounded-md transition-all ${typeFilter === 'all' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>All</button>
            <button onClick={() => setTypeFilter('received')} className={`px-3 py-2 rounded-md transition-all ${typeFilter === 'received' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Received</button>
            <button onClick={() => setTypeFilter('issued')} className={`px-3 py-2 rounded-md transition-all ${typeFilter === 'issued' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Issued</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
          <div className="relative min-w-[220px]">
            <input
              type="text"
              placeholder="Cheque no. or party..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="soleria-input w-full py-1.5 text-xs pr-9 font-semibold"
            />
            <Search className="absolute right-3 top-2 text-slate-400" size={14} />
          </div>
        </div>

        <button
          onClick={() => setIsPreviewOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
        >
          <Eye size={14} /> Show Print Preview
        </button>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                <th className="p-3 pl-4">Type</th>
                <th className="p-3">Cheque No.</th>
                <th className="p-3">Date</th>
                <th className="p-3">Event</th>
                <th className="p-3">Party</th>
                <th className="p-3">Bank</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-center">Reversed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center p-8 text-slate-400">Loading…</td></tr>
              ) : ledgerRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center p-8 text-slate-400">No cheque events match this filter.</td></tr>
              ) : (
                ledgerRows.map(r => (
                  <tr key={r.key} className={`border-b hover:bg-slate-50/50 ${r.reversed ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 pl-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300">{r.chequeType}</span>
                    </td>
                    <td className="p-3 font-mono font-semibold text-slate-800">{r.chequeNo}</td>
                    <td className="p-3 text-xs text-slate-600">{formatDate(r.date)}</td>
                    <td className="p-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${EVENT_STYLES[r.eventType]}`}>
                        {r.eventType}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{r.party}</td>
                    <td className="p-3 text-slate-600">{r.bank}</td>
                    <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(r.amount)}</td>
                    <td className="p-3 text-center">
                      {r.reversed && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-rose-50 text-rose-700 border-rose-200">
                          Reversed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {ledgerRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                  <td colSpan={6} className="p-4 text-left font-lora">TOTAL ({ledgerRows.length} events)</td>
                  <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(totals.totalAmount)}</td>
                  <td className="p-4 text-xs text-slate-500">
                    R: {formatCurrency(totals.totalReceived)} / I: {formatCurrency(totals.totalIssued)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Cheque Ledger - Print Preview"
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
