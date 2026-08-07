import { useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import * as api from '@/lib/api';
import { exportRowsToExcel } from '@/lib/export';
import type { BusinessLedgerSummaryRow, LedgerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

// Business Accounts Ledger — a general-purpose ledger over ALL business accounts (not just
// customers), since Account Ledger (Khaata) is scoped to customers only and Vendor Report is
// scoped to vendors only.
export default function BusinessLedgerContent() {
  const [viewMode, setViewMode] = useState<'summary' | 'detail' | 'customer'>('summary');
  const [accountFilter, setAccountFilter] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  const [summaryRows, setSummaryRows] = useState<BusinessLedgerSummaryRow[]>([]);
  const [detail, setDetail] = useState<{ opening_balance: number; rows: LedgerRow[]; total_debit: number; total_credit: number; closing_balance: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const res = await api.reports.businessLedger({ view: 'summary', date_to: toDate || undefined });
    if (res.ok && Array.isArray(res.data)) setSummaryRows(res.data);
    setLoading(false);
  }, [toDate]);

  useEffect(() => { if (viewMode !== 'detail') loadSummary(); }, [viewMode, loadSummary]);

  const visibleSummaryRows = useMemo(() => {
    if (viewMode === 'customer') return summaryRows.filter(r => r.category === 'CUSTOMER');
    return summaryRows;
  }, [summaryRows, viewMode]);

  const loadDetail = useCallback(async () => {
    if (!accountFilter) return;
    setLoading(true);
    const res = await api.reports.businessLedger({ view: 'detail', ba_id: accountFilter, date_from: fromDate || undefined, date_to: toDate || undefined });
    if (res.ok && !Array.isArray(res.data)) setDetail(res.data); else setDetail(null);
    setLoading(false);
  }, [accountFilter, fromDate, toDate]);

  useEffect(() => { if (viewMode === 'detail' && accountFilter) loadDetail(); }, [viewMode, accountFilter, loadDetail]);

  const selectedAccount = useMemo(() => summaryRows.find(b => b.ba_id === accountFilter), [accountFilter, summaryRows]);

  const handleExportExcel = () => {
    if (viewMode === 'detail') {
      const headers = ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'];
      const rows = (detail?.rows || []).map(e => [e.date, e.type, e.inv_no ?? e.bill_no ?? `#${e.entry_id}`, e.debit, e.credit, e.balance]);
      exportRowsToExcel(`business-ledger-${selectedAccount?.name || 'detail'}`, headers, rows);
    } else {
      const headers = ['Code', 'Description', 'Main Account', 'City / Region', 'Closing Balance'];
      const rows = visibleSummaryRows.map(r => [r.code, r.name, r.main_account, r.city_name || '', r.closing_balance]);
      exportRowsToExcel('business-ledger-summary', headers, rows);
    }
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '180px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              BUSINESS LEDGER REPORT — {viewMode.toUpperCase()} VIEW
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {fromDate || 'Start'} to {toDate || 'End'}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        {viewMode === 'detail' && selectedAccount ? (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Transaction Type</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Ref #</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (IN)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (OUT)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.rows || []).map(e => (
                <tr key={e.entry_id}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{e.date}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{e.type}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{e.inv_no ?? e.bill_no ?? `#${e.entry_id}`}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(e.balance)}</td>
                </tr>
              ))}
              {detail && (
                <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
                  <td colSpan={3} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL</td>
                  <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(detail.total_debit)}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(detail.total_credit)}</td>
                  <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline' }}>{formatCurrency(detail.closing_balance)}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Code</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Account Description</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Main Account</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>City / Region</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummaryRows.map(row => (
                <tr key={row.ba_id}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.code}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{row.name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{row.main_account}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{row.city_name || '—'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(row.closing_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', padding: '0 10px' }}>
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
      </div>
    );
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
            <button onClick={() => setViewMode('summary')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'summary' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Summary</button>
            <button onClick={() => setViewMode('detail')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'detail' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Detail</button>
            <button onClick={() => setViewMode('customer')} className={`px-3 py-2 rounded-md transition-all ${viewMode === 'customer' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}>Customer</button>
          </div>

          {viewMode === 'detail' && (
            <div className="min-w-[240px]">
              <SearchableSelect
                options={summaryRows.map(b => ({
                  value: String(b.ba_id),
                  label: `${b.name} (${b.code})`
                }))}
                value={accountFilter != null ? String(accountFilter) : ''}
                onChange={val => setAccountFilter(val ? Number(val) : null)}
                placeholder="Select an account..."
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 text-xs" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={14} /> Show Print Preview
          </button>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        {viewMode === 'detail' ? (
          !accountFilter ? (
            <div className="text-center p-8 text-slate-400">Select an account above to view its transaction detail.</div>
          ) : loading ? (
            <div className="text-center p-8 text-slate-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-lora font-semibold text-lg text-slate-800">{selectedAccount?.name}</h3>
                  <p className="text-xs text-slate-500">Code: {selectedAccount?.code}</p>
                </div>
                <div className="text-right text-xs font-semibold text-slate-500">
                  Opening Balance: <span className="text-slate-800 font-bold">{formatCurrency(detail?.opening_balance || 0)}</span>
                </div>
              </div>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                    <th className="p-3 pl-4">Date</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Ref</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {!detail || detail.rows.length === 0 ? (
                    <tr><td colSpan={6} className="text-center p-8 text-slate-400">No transactions found for this account / date range.</td></tr>
                  ) : (
                    detail.rows.map((e) => (
                      <tr key={e.entry_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 pl-4 font-mono text-slate-600">{e.date}</td>
                        <td className="p-3 text-slate-700">{e.type}</td>
                        <td className="p-3 text-slate-500">{e.inv_no ?? e.bill_no ?? `#${e.entry_id}`}</td>
                        <td className="p-3 text-right font-bold text-rose-700">{e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(e.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {detail && detail.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 text-slate-700" style={{ borderColor: 'var(--border-color)' }}>
                      <td colSpan={3} className="p-4 text-left font-lora">TOTAL</td>
                      <td className="p-4 text-right text-rose-800">{formatCurrency(detail.total_debit)}</td>
                      <td className="p-4 text-right text-emerald-800">{formatCurrency(detail.total_credit)}</td>
                      <td className="p-4 text-right" style={{ color: 'var(--brand-gold)' }}>{formatCurrency(detail.closing_balance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                  <th className="p-3 pl-4">Code</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Main Account</th>
                  <th className="p-3">City / Region</th>
                  <th className="p-3 text-right">Closing Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center p-8 text-slate-400">Loading…</td></tr>
                ) : visibleSummaryRows.length === 0 ? (
                  <tr><td colSpan={5} className="text-center p-8 text-slate-400">No business accounts found.</td></tr>
                ) : (
                  visibleSummaryRows.map(row => (
                    <tr key={row.ba_id} className="border-b hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 pl-4 font-mono text-slate-600">{row.code}</td>
                      <td className="p-3 font-semibold text-slate-800">{row.name}</td>
                      <td className="p-3 text-slate-500">{row.main_account}</td>
                      <td className="p-3 text-slate-500">{row.city_name || '—'}</td>
                      <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.closing_balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Business Ledger Report - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
