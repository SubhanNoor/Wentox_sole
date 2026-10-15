import { Fragment, useState, useMemo, useEffect } from 'react';
import SkipZeroToggle, { isZeroBalance } from '@/components/SkipZeroToggle';
import { formatCurrency, balanceColor } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import SearchableSelect from '@/components/SearchableSelect';
import { Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate, formatDate, formatDateTime } from '@/lib/utils';
import * as api from '@/lib/api';
import type { VendorReportRow, VendorRow, LedgerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { IS_PREVIEW_WINDOW, closePreviewWindow } from '@/components/reports/previewWindow';
import LiveReportDocument from '@/components/reports/LiveReportDocument';
import { REPORT_COLORS, signedColor } from '@/components/reports/reportColors';
import { getWindowParam } from '@/lib/windowParams';
import { useDataVersion } from '@/hooks/useDataVersion';


type Loaded = { key: string; groupRows: VendorReportRow[]; ledger: { opening_balance: number; rows: LedgerRow[] } | null; error: string | null };

export function VendorReportContent() {
  // Re-runs the loads below when another window saves something (live update, 2026-10-15).
  const dataVersion = useDataVersion();
  // Product Ledger layout (per the user, 2026-10-14): filter bar on top, the printed document under
  // it. Vendor "all" = summary of every vendor; a vendor picked = that vendor's ledger statement.
  // Every visit starts fresh (all vendors, Skip Zero off, last 3 months -> today), per the user.
  const [vendorFilter, setVendorFilter] = useState(() => getWindowParam('vendor') || 'all');
  const [skipZero, setSkipZero] = useState(() => getWindowParam('skipZero') === '1');
  const [fromDate, setFromDate] = useState(() => getWindowParam('fromDate') ?? getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(() => getWindowParam('toDate') ?? getTodayDate());

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => { api.listVendors().then(r => { if (r.ok) setVendors(r.data); }); }, [dataVersion]);

  const selectedVendorId = vendorFilter !== 'all' ? Number(vendorFilter) : null;

  // What's on screen belongs to one set of filters (`key`); until the data for the current filters
  // arrives, the previous document stays up — no flash of an empty sheet while typing a date.
  const loadKey = `${vendorFilter}|${fromDate}|${toDate}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const range = { date_from: fromDate || undefined, date_to: toDate || undefined };
    const request = selectedVendorId != null
      ? api.reports.vendorLedger({ vendor_id: selectedVendorId, ...range }).then(res => (res.ok
        ? { groupRows: [], ledger: res.data, error: null }
        : { groupRows: [], ledger: null, error: res.error.message }))
      : api.reports.vendorReport(range).then(res => (res.ok
        ? { groupRows: res.data, ledger: null, error: null }
        : { groupRows: [], ledger: null, error: res.error.message }));
    let cancelled = false;
    request.then(data => {
      if (cancelled) return;
      setLoaded({ key: loadKey, ...data });
      if (IS_PREVIEW_WINDOW && !data.error) setIsPreviewOpen(true);
    });
    return () => { cancelled = true; };
  }, [loadKey, selectedVendorId, fromDate, toDate, dataVersion]);

  const vendorGroupRows = useMemo(() => loaded?.groupRows ?? [], [loaded]);
  const ledger = loaded?.ledger ?? null;
  // The document shows what was LOADED, which can still be the previous vendor choice for a moment.
  const loadedVendor = loaded ? loaded.key.split('|')[0] : vendorFilter;
  const docVendorId = loadedVendor !== 'all' ? Number(loadedVendor) : null;
  const docVendor = useMemo(() => vendors.find(v => v.vendor_id === docVendorId), [docVendorId, vendors]);

  const handleShowPrintPreview = () => {
    api.openWindow('reports', 'vendor', {
      vendor: vendorFilter, fromDate, toDate, skipZero: skipZero ? '1' : '0', autoPreview: '1',
    });
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
    closePreviewWindow();
  };

  const filteredGroupRows = useMemo(
    () => vendorGroupRows.filter(r => !(skipZero && isZeroBalance(r.balance))),
    [vendorGroupRows, skipZero],
  );

  const grandTotals = useMemo(() => {
    return filteredGroupRows.reduce((acc, r) => ({
      totalPurchase: acc.totalPurchase + r.total_purchase,
      purchaseReturn: acc.purchaseReturn + r.total_return,
      netPurchase: acc.netPurchase + r.net_purchase,
      paymentPaid: acc.paymentPaid + r.payment_paid,
      balance: acc.balance + r.balance
    }), { totalPurchase: 0, purchaseReturn: 0, netPurchase: 0, paymentPaid: 0, balance: 0 });
  }, [filteredGroupRows]);

  // Opening Balance synthetic row + running balance — the backend already computes
  // opening_balance and each row's own running balance, no client-side math needed.
  const runningVendorLedger = useMemo(() => {
    if (!ledger) return [];
    return [
      { date: fromDate ? `Before ${formatDate(fromDate)}` : '---', type: 'Opening Balance', ref: '-', debit: 0, credit: 0, balance: ledger.opening_balance },
      ...ledger.rows.map(r => ({ date: formatDate(r.date), type: r.type, ref: r.inv_no ?? r.bill_no ?? `#${r.entry_id}`, debit: r.debit, credit: r.credit, balance: r.balance })),
    ];
  }, [ledger, fromDate]);

  const handleExportGroupedExcel = () => {
    const headers = ['Vendor / Supplier', 'Total Purchase', 'Purchase Return', 'Net Purchase', 'Payment Paid', 'Balance'];
    const rows = filteredGroupRows.map(r => [r.vendor_name, r.total_purchase, r.total_return, r.net_purchase, r.payment_paid, r.balance]);
    exportRowsToExcel('vendor-report-grouped', headers, rows);
  };

  const handleExportLedgerExcel = () => {
    const headers = ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'];
    const rows = runningVendorLedger.map(r => [formatDate(r.date), r.type, r.ref, r.debit, r.credit, r.balance]);
    exportRowsToExcel(`vendor-ledger-${docVendor?.name || 'export'}`, headers, rows);
  };

  const renderPrintableDocument = () => {
    return (
      <div className="excel-print-container">
        <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
          <div>
            <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              {docVendorId ? `VENDOR LEDGER STATEMENT — ${docVendor?.name?.toUpperCase()}` : 'VENDOR REPORT — GROUPED SUMMARY'}
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', fontWeight: 'bold', color: '#111111' }}>
              Period: {fromDate ? formatDate(fromDate) : 'Start'} to {toDate ? formatDate(toDate) : 'End'}
            </p>
            <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
              Date of Print: {formatDate(new Date())}
            </p>
          </div>
        </div>

        {!docVendorId ? (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Vendor / Supplier</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total Purchase</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Purchase Return</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Net Purchase</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Payment Paid</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroupRows.map(row => (
                <Fragment key={row.vendor_id}>
                <tr>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{row.vendor_name}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{row.total_purchase > 0 ? formatCurrency(row.total_purchase) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{row.total_return > 0 ? formatCurrency(row.total_return) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.gold }}>{formatCurrency(row.net_purchase)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{row.payment_paid > 0 ? formatCurrency(row.payment_paid) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: signedColor(row.balance) }}>{formatCurrency(row.balance)}</td>
                </tr>
                {/* A Journal Voucher gets its own row under the vendor rather than a column: it
                    reduces what is owed but is not a payment, and most vendors have none. */}
                {row.total_jv !== 0 && (
                  <tr>
                    <td colSpan={4} style={{ border: '1px solid #000000', padding: '3px 6px 3px 20px', fontSize: '10px', fontStyle: 'italic' }}>Journal Voucher applied</td>
                    <td style={{ border: '1px solid #000000', padding: '3px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(Math.abs(row.total_jv))}</td>
                    <td style={{ border: '1px solid #000000', padding: '3px 6px' }} />
                  </tr>
                )}
                </Fragment>
              ))}
              <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f2f2f2' }}>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>GRAND TOTAL</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.text }}>{formatCurrency(grandTotals.totalPurchase)}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.returns }}>{formatCurrency(grandTotals.purchaseReturn)}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.gold }}>{formatCurrency(grandTotals.netPurchase)}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: REPORT_COLORS.payment }}>{formatCurrency(grandTotals.paymentPaid)}</td>
                <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', textDecoration: 'underline', color: signedColor(grandTotals.balance) }}>{formatCurrency(grandTotals.balance)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Transaction Type</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Ref #</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Debit (IN)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Credit (OUT)</th>
                <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right', width: '130px', minWidth: '130px', whiteSpace: 'nowrap' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {runningVendorLedger.map((row, idx) => (
                <tr key={idx} style={{ backgroundColor: idx === 0 ? '#f9f9f9' : '#ffffff', fontWeight: idx === 0 ? 'bold' : 'normal' }}>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{formatDate(row.date)}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{row.type}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px' }}>{row.ref}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#047857' }}>{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace', color: '#e11d48' }}>{row.credit > 0 ? `(${formatCurrency(row.credit)})` : '-'}</td>
                  <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: balanceColor(row.balance) }}>{formatCurrency(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
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

        <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
          <div>WENTOX FOOTWEAR DISTRIBUTION</div>
          <div>Printed: {formatDateTime(new Date())}</div>
        </div>
      </div>
    );
  };

  const preview = (
    <ReportPrintPreviewModal
      isOpen={isPreviewOpen}
      onClose={closePreview}
      title={docVendorId ? `Vendor Ledger - ${docVendor?.name}` : 'Vendor Report - Print Preview'}
      orientation="portrait"
      onExportExcel={docVendorId ? handleExportLedgerExcel : handleExportGroupedExcel}
    >
      {renderPrintableDocument()}
    </ReportPrintPreviewModal>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      {/* Filter Bar - data-no-print */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border mb-6 bg-white shadow-sm" style={{ borderColor: 'var(--border-color)' }} data-no-print>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <SearchableSelect
              options={[
                { value: 'all', label: 'All vendors (summary)' },
                ...vendors.map(v => ({ value: String(v.vendor_id), label: v.name })),
              ]}
              value={vendorFilter}
              onChange={setVendorFilter}
              placeholder="All vendors (summary)"
              searchPlaceholder="Type a vendor name..."
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">From:</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase">To:</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="soleria-input py-1.5 px-3 text-sm" />
          </div>
          {vendorFilter === 'all' && <SkipZeroToggle value={skipZero} onChange={setSkipZero} />}
        </div>
        <button
          onClick={handleShowPrintPreview}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
        >
          <Eye size={14} /> Show Print Preview
        </button>
      </div>

      {loaded?.error && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{loaded.error}</div>}

      <LiveReportDocument loading={!loaded}>
        {renderPrintableDocument()}
      </LiveReportDocument>

      {preview}
    </div>
  );
}

export default function VendorReportPage() {
  return (
    <AppLayout pageTitle="Vendor Report">
      <VendorReportContent />
    </AppLayout>
  );
}
