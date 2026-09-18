import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Search, Edit2, Printer } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { formatDate, formatDateTime } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { SaleBillRow, AddaRow, StoreRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';
import { SaleBillPrintable, type SaleBillPrintModel } from '@/components/reports/SaleBillPrintable';
import { getWindowParam, isChildWindow } from '@/lib/windowParams';

export default function BiltyUpdatePage() {
  // Search Filters State
  const [startDate, setStartDate] = useState(() => getWindowParam('startDate') || '');
  const [endDate, setEndDate] = useState(() => getWindowParam('endDate') || '');
  const [customerQuery, setCustomerQuery] = useState(() => getWindowParam('customerQuery') || '');
  const [subCustomerQuery, setSubCustomerQuery] = useState(() => getWindowParam('subCustomerQuery') || '');
  // BA-01: manual (client-typed) and system-generated (IDENTITY bill_id) bill numbers are
  // separate fields — each filters client-side against its own column, same pattern as
  // customerQuery/subCustomerQuery below, rather than one combined field guessing which is meant.
  const [manualBillNoQuery, setManualBillNoQuery] = useState(() => getWindowParam('manualBillNoQuery') || '');
  const [systemBillNoQuery, setSystemBillNoQuery] = useState(() => getWindowParam('systemBillNoQuery') || '');
  const [biltyNoQuery, setBiltyNoQuery] = useState(() => getWindowParam('biltyNoQuery') || '');

  // Radio Filters State
  const [biltyStatusFilter, setBiltyStatusFilter] = useState<'all' | 'no-bilty' | 'no-adda' | 'has-bilty'>(() => (getWindowParam('biltyStatusFilter') as 'all' | 'no-bilty' | 'no-adda' | 'has-bilty') || 'all');
  const [sortBy, setSortBy] = useState<'inv-no' | 'bill-no'>(() => (getWindowParam('sortBy') as 'inv-no' | 'bill-no') || 'inv-no');

  // Selected Invoice for Updation
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [updateBillNo, setUpdateBillNo] = useState('');
  const [updateBiltyNo, setUpdateBiltyNo] = useState('');
  const [updateAddaId, setUpdateAddaId] = useState('');

  // Notification state
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // G-03 (changes-14-09-26.md): the cursor lands in the first input on open.
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // Focused after selecting a row for editing (see handleSelectBill below) — separate from
  // firstFieldRef, which is only for G-03's own "focus the first field on page open" rule.
  const updateBiltyNoRef = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => firstFieldRef.current?.focus()); }, []);

  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [invoices, setInvoices] = useState<SaleBillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => { api.listAddas().then(r => { if (r.ok) setAddas(r.data); }); }, []);
  useEffect(() => { api.listStores().then(r => { if (r.ok) setStores(r.data); }); }, []);

  // BA-01 (changes-14-09-26.md, 2026-09-15): print a bill straight from its row here, without
  // navigating to the Sale Bill page first. Reuses the exact same <SaleBillPrintable> template
  // Sale Bill itself renders — see that component's own header comment — so there is only ever
  // one invoice layout in circulation. `invoices` (from biltySearch()) already carries the joined
  // customer/sub-customer/adda names but never `items` or the store name, so a fresh full fetch
  // is needed; this page never shows drafts (bilty/adda updates are POSTED-bill only, per UC-07),
  // so api.saleBills.get() is always the right call, never draftSaleBills.
  const [printingBill, setPrintingBill] = useState<SaleBillPrintModel | null>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const handlePrintBill = async (row: SaleBillRow) => {
    const res = await api.saleBills.get(row.bill_id);
    if (!res.ok) { setErrorMsg('Failed to load bill for printing: ' + res.error.message); return; }
    const bill = res.data;
    const storeObj = stores.find(s => s.store_id === bill.store_id);
    setPrintingBill({
      statusLabel: bill.is_posted ? 'Posted' : 'Unposted',
      systemNo: bill.system_no,
      date: bill.bill_date,
      storeName: storeObj ? storeObj.name : (bill.store_id != null ? String(bill.store_id) : 'N/A'),
      billNo: bill.bill_no,
      customerName: row.customer_name || 'N/A',
      subCustomerName: bill.sub_customer_id != null ? (row.sub_customer_name || 'N/A') : 'SAME (Direct)',
      isCustomDelivery: bill.delivery_type === 'CUSTOM',
      customAddress: bill.delivery_address || '',
      addaName: bill.adda_id != null ? (row.adda_name || 'N/A') : 'N/A',
      gpNo: bill.gp_no || '',
      biltyNo: bill.bilty_no || '',
      remarks: bill.remarks || '',
      items: bill.items.map(it => ({
        uid: 'item_' + it.item_id,
        label: `${it.article_name || 'Article'} — ${it.color || ''}`,
        packing: it.pairs && it.cartons ? it.pairs / it.cartons : 0,
        cartons: it.cartons,
        pairs: it.pairs,
        rate: it.rate,
        discountPercent: it.discount_percent,
        discountValue: it.discount_value,
        value: it.value,
      })),
      totalCartons: bill.total_cartons,
      totalPairs: bill.total_pairs,
      itemsTotalValue: bill.gross_value,
      invoiceDiscount: bill.invoice_discount,
      finalTotalValue: bill.net_value,
    });
    setIsPrintOpen(true);
  };

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const res = await api.saleBills.biltySearch({
      date_from: startDate || undefined,
      date_to: endDate || undefined,
    });
    if (res.ok) setInvoices(res.data);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [startDate, endDate]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // "Show Print Preview" opens a new window on this same filtered directory (per the user,
  // 2026-09-03), instead of an in-page overlay.
  const handleShowPrintPreview = () => {
    api.openWindow('bilty-update', undefined, {
      startDate, endDate, customerQuery, subCustomerQuery, manualBillNoQuery, systemBillNoQuery,
      biltyNoQuery, biltyStatusFilter, sortBy, autoPreview: '1',
    });
  };

  // Opened via another window's "Show Print Preview" — go straight into the preview once loaded.
  useEffect(() => {
    if (isChildWindow() && getWindowParam('autoPreview') === '1' && hasLoadedOnce) setIsPreviewOpen(true);
  }, [hasLoadedOnce]);

  // Select a bill from table — per the user, 2026-09-16: clicking a row's Edit icon should land
  // the cursor straight in the first field there is actually something to edit, not leave it
  // wherever it happened to be. "Selected Bill No." is read-only, so that's the Bilty No. input.
  const handleSelectBill = (bill: SaleBillRow) => {
    setSelectedBillId(bill.bill_id);
    setUpdateBillNo(bill.bill_no);
    setUpdateBiltyNo(bill.bilty_no || '');
    setUpdateAddaId(bill.adda_id ? String(bill.adda_id) : (addas[0] ? String(addas[0].adda_id) : ''));
    setErrorMsg('');
    requestAnimationFrame(() => updateBiltyNoRef.current?.focus());
  };

  // Perform Update
  const handleUpdateBilty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBillId) {
      setErrorMsg('Please select an invoice from the table below first.');
      return;
    }
    if (!updateBiltyNo.trim()) {
      setErrorMsg('Please enter a valid Bilty Number.');
      return;
    }
    if (!updateAddaId) {
      setErrorMsg('Please select a Transport Adda.');
      return;
    }

    const res = await api.saleBills.updateBilty(selectedBillId, updateBiltyNo, Number(updateAddaId));
    if (!res.ok) {
      setErrorMsg(res.error.message);
      return;
    }

    setSuccessMsg(`Bilty updated successfully for Bill No: ${updateBillNo}`);
    setTimeout(() => setSuccessMsg(''), 3000);

    // Clear selection
    setSelectedBillId(null);
    setUpdateBillNo('');
    setUpdateBiltyNo('');
    setErrorMsg('');
    loadInvoices();
  };

  const handleExportExcel = () => {
    const headers = ['Invoice Date', 'Inv. No (Sys)', 'Manual No.', 'Customer Name', 'Sub Customer Name', 'Bilty No.', 'Transport Adda', 'Adda Code'];
    const rows = filteredInvoices.map(bill => [
      formatDate(bill.bill_date), bill.system_no, bill.bill_no,
      bill.customer_name || '-',
      bill.sub_customer_name || 'SAME (Direct)',
      bill.bilty_no || '-',
      bill.adda_name || 'Not Assigned',
      bill.adda_id || '-'
    ]);
    exportRowsToExcel('bilty-adda-search', headers, rows);
  };

  // Client-side filters
  const filteredInvoices = useMemo(() => {
    let result = [...invoices];

    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(b => (b.customer_name || '').toLowerCase().includes(q));
    }

    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(b => (b.sub_customer_name || '').toLowerCase().includes(q));
    }

    if (manualBillNoQuery.trim()) {
      const q = manualBillNoQuery.trim().toLowerCase();
      result = result.filter(b => b.bill_no.toLowerCase().includes(q));
    }

    if (systemBillNoQuery.trim()) {
      const q = systemBillNoQuery.trim();
      result = result.filter(b => String(b.system_no).includes(q));
    }

    if (biltyNoQuery.trim()) {
      const q = biltyNoQuery.trim().toLowerCase();
      result = result.filter(b => (b.bilty_no || '').toLowerCase().includes(q));
    }

    if (biltyStatusFilter === 'no-bilty') {
      result = result.filter(b => !b.bilty_no || b.bilty_no.trim() === '');
    } else if (biltyStatusFilter === 'no-adda') {
      result = result.filter(b => !b.adda_id);
    } else if (biltyStatusFilter === 'has-bilty') {
      result = result.filter(b => b.bilty_no && b.bilty_no.trim() !== '');
    }

    result.sort((a, b) => {
      if (sortBy === 'inv-no') return a.system_no - b.system_no;
      // numeric: true, or the digits inside a bill number sort as text and BILL-10 lands before
      // BILL-9 — wrong for any customer past their ninth bill. Same options ChartAcSetupPage and
      // BusinessAcSetupPage already use for account codes.
      return a.bill_no.localeCompare(b.bill_no, undefined, { numeric: true, sensitivity: 'base' });
    });

    return result;
  }, [invoices, customerQuery, subCustomerQuery, manualBillNoQuery, systemBillNoQuery, biltyNoQuery, biltyStatusFilter, sortBy]);

  // Count summary helpers
  const missingBilty = filteredInvoices.filter(b => !b.bilty_no || !b.bilty_no.trim()).length;
  const missingAdda = filteredInvoices.filter(b => !b.adda_id).length;
  const complete = filteredInvoices.filter(b => b.bilty_no && b.bilty_no.trim() && b.adda_id).length;

  /* ─── Print Preview Document ─── */
  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      {/* Header */}
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', marginBottom: '14px', paddingBottom: '10px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'bold' }}>BILTY &amp; ADDA UPDATION REPORT</h2>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#444' }}>
            Period: {startDate ? formatDate(startDate) : 'All'} — {endDate ? formatDate(endDate) : 'All'}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#555' }}>
            Date of Print: {formatDate(new Date())}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', fontWeight: 'bold' }}>
            Total Records: {filteredInvoices.length} &nbsp;|&nbsp;
            Missing Bilty: {missingBilty} &nbsp;|&nbsp;
            Missing Adda: {missingAdda} &nbsp;|&nbsp;
            Complete: {complete}
          </p>
        </div>
      </div>

      {/* Active Filters summary */}
      {(customerQuery || subCustomerQuery || manualBillNoQuery || systemBillNoQuery || biltyStatusFilter !== 'all') && (
        <p style={{ fontSize: '10px', color: '#555', marginBottom: '10px', fontStyle: 'italic' }}>
          Filters applied —
          {customerQuery ? ` Customer: "${customerQuery}"` : ''}
          {subCustomerQuery ? ` Sub-Customer: "${subCustomerQuery}"` : ''}
          {manualBillNoQuery ? ` Manual Bill No: "${manualBillNoQuery}"` : ''}
          {systemBillNoQuery ? ` System Bill No: "${systemBillNoQuery}"` : ''}
          {biltyStatusFilter !== 'all' ? ` Status: ${biltyStatusFilter}` : ''}
        </p>
      )}

      {/* Table */}
      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', whiteSpace: 'nowrap' }}>Date</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>Inv. No (Sys)</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>Manual No.</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Customer Name</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Sub Customer</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left', whiteSpace: 'nowrap' }}>Bilty No.</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Transport Adda</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>Adda Code</th>
          </tr>
        </thead>
        <tbody>
          {filteredInvoices.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ border: '1px solid #000', padding: '12px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>
                No records found.
              </td>
            </tr>
          ) : filteredInvoices.map((bill, idx) => {
            const missingB = !bill.bilty_no || !bill.bilty_no.trim();
            const missingA = !bill.adda_id;
            const rowBg = missingB || missingA ? '#fff8f0' : (idx % 2 === 0 ? '#ffffff' : '#fafafa');
            return (
              <tr key={bill.bill_id} style={{ backgroundColor: rowBg }}>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace' }}>{formatDate(bill.bill_date)}</td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', textAlign: 'center' }}>{bill.system_no}</td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', textAlign: 'center', fontWeight: 'bold' }}>{bill.bill_no}</td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontWeight: 'bold' }}>{bill.customer_name || '-'}</td>
                <td style={{ border: '1px solid #000', padding: '4px 7px' }}>{bill.sub_customer_name || 'SAME (Direct)'}</td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', color: missingB ? '#cc0000' : '#000', fontStyle: missingB ? 'italic' : 'normal' }}>
                  {bill.bilty_no || 'MISSING'}
                </td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', color: missingA ? '#cc0000' : '#000', fontStyle: missingA ? 'italic' : 'normal' }}>
                  {bill.adda_name || 'UNASSIGNED'}
                </td>
                <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', textAlign: 'center', fontSize: '10px', color: '#666' }}>
                  {bill.adda_id || '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ backgroundColor: '#e8e8e8', fontWeight: 'bold' }}>
            <td colSpan={4} style={{ border: '1px solid #000', padding: '5px 7px', fontSize: '11px' }}>
              TOTALS — {filteredInvoices.length} records
            </td>
            <td colSpan={2} style={{ border: '1px solid #000', padding: '5px 7px', fontSize: '10.5px', color: '#cc0000' }}>
              Missing Bilty: {missingBilty}
            </td>
            <td colSpan={2} style={{ border: '1px solid #000', padding: '5px 7px', fontSize: '10.5px', color: '#cc0000' }}>
              Missing Adda: {missingAdda}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Signature & Print Info footer */}
      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Prepared By</span>
        </div>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Checked By</span>
        </div>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Authorized Sign</span>
        </div>
      </div>

      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDateTime(new Date())}</div>
      </div>
    </div>
  );

  return (
    <AppLayout pageTitle="Search & Bilty Adda Updation">

      {/* Print Preview Modal */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Bilty & Adda Updation Report"
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>

      {/* BA-01: single-bill print preview, reusing the exact Sale Bill invoice template. */}
      <ReportPrintPreviewModal
        isOpen={isPrintOpen}
        onClose={() => setIsPrintOpen(false)}
        title={printingBill ? `Sale Invoice #${printingBill.billNo}` : 'Sale Invoice'}
        orientation="portrait"
      >
        {printingBill && <SaleBillPrintable model={printingBill} />}
      </ReportPrintPreviewModal>

      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Success/Error Alerts */}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-2.5 text-sm mb-3">{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-2.5 text-sm mb-3">{errorMsg}</div>
        )}

        {/* BA-02 (changes-14-09-26.md, 2026-09-15) — the wider redesign, per the client's own
            reference photo (`ref-pics/batch2/billity adda.jpeg`): ONE consolidated toolbar card
            (search filters + the selected-invoice update cluster + Update/Print together, matching
            the ref pic's single dense strip) instead of two side-by-side cards, radio filters in
            one row beneath it, exactly mirroring the reference's own
            "SEARCH & BILTY ADDA UPDATION" bar. Kept the app's richer superset of fields the
            reference's single "By Date"/"By Bill No." boxes don't have room for (a Start/End date
            RANGE instead of one date, and the Manual/System bill-no split from BA-01) — per the
            user, 2026-09-16: match the layout, don't lose capability already built. */}
        <div className="card-white p-3 bg-white border flex flex-col gap-2 mb-3">
          <h3 className="font-lora font-semibold text-base border-b pb-2 text-slate-800 flex items-center gap-2">
            <Search size={16} className="text-blue-600" /> Search &amp; Bilty Adda Updation
          </h3>

          {/* Search filters — same fields as before, now one row (wraps on narrow windows)
              instead of a separate card, matching the ref pic's own single filter strip. */}
          {/* Reported (2026-09-16): packed into up to 7 columns, fields had no visible gap between
              them at this app's very light --border-color, reading as one merged blur of text.
              Backed off to 4 columns max (wraps to 2 rows for 7 fields) with a wider gap — same
              fix direction as every other multi-field row in the app (SaleBillPage/ReceiptsPage
              never pack more than ~4 fields per row for exactly this reason). */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Start Date</label>
              <input ref={firstFieldRef} type="date"
                value={startDate} onChange={e => setStartDate(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">End Date</label>
              <input type="date"
                value={endDate} onChange={e => setEndDate(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Customer Name</label>
              <input type="text" placeholder="Search customer..." value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Sub Customer Name</label>
              <input type="text" placeholder="Search sub customer..." value={subCustomerQuery} onChange={e => setSubCustomerQuery(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Manual Bill No.</label>
              <input type="text" placeholder="Client-typed bill no..." value={manualBillNoQuery} onChange={e => setManualBillNoQuery(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">System Bill No. (Inv #)</label>
              <input type="text" placeholder="System-generated Inv #..." value={systemBillNoQuery} onChange={e => setSystemBillNoQuery(e.target.value)} className="soleria-input-compact" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Bilty No.</label>
              <input type="text" placeholder="Search bilty no..." value={biltyNoQuery} onChange={e => setBiltyNoQuery(e.target.value)} className="soleria-input-compact" />
            </div>
          </div>

          {/* Selected-invoice update cluster + Update/Print, together on their own row — matching
              the ref pic's own "Enter Bill No. / Enter Bilty No. / Select Adda / Update / Print"
              grouping at the right of its toolbar. */}
          <form onSubmit={handleUpdateBilty} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-[1fr_1fr_1.4fr_auto_auto] gap-x-4 gap-y-2 items-end pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
                Selected Bill No.
              </label>
              <input
                type="text"
                value={updateBillNo}
                readOnly
                disabled
                placeholder="Click a row to select..."
                className="soleria-input-compact bg-slate-50 text-slate-500 font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
                Enter Bilty No.
              </label>
              <input
                ref={updateBiltyNoRef}
                type="text"
                value={updateBiltyNo}
                onChange={e => setUpdateBiltyNo(e.target.value)}
                placeholder="Enter Bilty No..."
                className="soleria-input-compact"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
                Select Adda
              </label>
              <SearchableSelect
                options={[
                  { value: '', label: 'Select Adda...' },
                  ...addas.map(ad => ({ value: String(ad.adda_id), label: ad.name }))
                ]}
                value={updateAddaId}
                onChange={setUpdateAddaId}
                placeholder="Select Adda..."
              />
            </div>
            <button
              type="submit"
              className="btn-gold px-4 cursor-pointer whitespace-nowrap"
              disabled={!selectedBillId}
            >
              Update
            </button>
            <button
              type="button"
              onClick={handleShowPrintPreview}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs whitespace-nowrap"
            >
              <Printer size={14} /> Print
            </button>
          </form>

          {/* Radio Sorting / Filters Options — one row, matching the ref pic's own single strip of
              "All Invoices / Invoices without Bilty No. / ... / Sort by Inv.No. / Sort by Bill
              No." radio buttons. */}
          {/* Per the user, 2026-09-16: real radio buttons — a circle that fills when selected,
              plain label text — not the filled-pill toggle buttons this used to be. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Show:</span>
            {[
              { id: 'all', label: 'All Invoices' },
              { id: 'no-bilty', label: 'Without Bilty' },
              { id: 'no-adda', label: 'Without Adda' },
              { id: 'has-bilty', label: 'With Bilty' },
            ].map(opt => (
              <label key={opt.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="radio"
                  name="bilty-status-filter"
                  checked={biltyStatusFilter === opt.id}
                  onChange={() => setBiltyStatusFilter(opt.id as 'all' | 'no-bilty' | 'no-adda' | 'has-bilty')}
                  className="w-3.5 h-3.5 cursor-pointer accent-[#111c2a]"
                />
                {opt.label}
              </label>
            ))}
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide ml-2">Sort by:</span>
            {[
              { id: 'inv-no', label: 'Invoice No.' },
              { id: 'bill-no', label: 'Manual Bill No.' },
            ].map(opt => (
              <label key={opt.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="radio"
                  name="bilty-sort-by"
                  checked={sortBy === opt.id}
                  onChange={() => setSortBy(opt.id as 'inv-no' | 'bill-no')}
                  className="w-3.5 h-3.5 cursor-pointer accent-[#111c2a]"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Results summary — not in the ref pic, kept from the earlier build since it's useful
            at-a-glance information the reference's own grid doesn't surface any other way. */}
        <div className="flex items-center gap-4 mb-3">
          <span className="text-sm font-semibold text-slate-600">
            Found <span className="text-[var(--brand-navy)] font-bold">{filteredInvoices.length}</span> invoices
          </span>
          {missingBilty > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 font-semibold">
              {missingBilty} missing bilty
            </span>
          )}
          {missingAdda > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-200 font-semibold">
              {missingAdda} missing adda
            </span>
          )}
          {complete > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              {complete} complete
            </span>
          )}
        </div>

        {/* Invoices Table */}
        <div className="card-white bg-white border border-slate-200/80 rounded-2xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                <th className="p-3 pl-4">Invoice Date</th>
                <th className="p-3 text-center">Inv. No (Sys)</th>
                <th className="p-3 text-center">Manual No.</th>
                <th className="p-3">Customer Name</th>
                <th className="p-3">Sub Customer Name</th>
                <th className="p-3">Bilty No.</th>
                <th className="p-3">Transport Adda</th>
                <th className="p-3 text-center" style={{ width: '80px' }}>Adda Code</th>
                <th className="p-3 text-center" style={{ width: '70px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center p-8 text-slate-400 text-sm">Loading…</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-8 text-slate-400 text-sm">
                    No invoices match your selected search criteria.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(bill => {
                  const isSelected = selectedBillId === bill.bill_id;

                  return (
                    <tr
                      key={bill.bill_id}
                      className={`border-b text-sm transition-colors ${isSelected ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-slate-50/50'}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-3 pl-4 font-mono">{formatDate(bill.bill_date)}</td>
                      <td className="p-3 text-center font-mono">{bill.system_no}</td>
                      <td className="p-3 text-center font-mono font-semibold">{bill.bill_no}</td>
                      <td className="p-3 font-semibold text-slate-700">{bill.customer_name || '-'}</td>
                      <td className="p-3 text-slate-600">{bill.sub_customer_name || 'SAME (Direct)'}</td>
                      <td className="p-3 font-mono">
                        {bill.bilty_no ? (
                          <span className="font-semibold text-slate-800">{bill.bilty_no}</span>
                        ) : (
                          <span className="text-red-500 italic text-xs">Missing</span>
                        )}
                      </td>
                      <td className="p-3">
                        {bill.adda_id ? (
                          <span className="text-slate-700">{bill.adda_name}</span>
                        ) : (
                          <span className="text-slate-400 italic text-xs">Unassigned</span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono text-xs text-slate-500">
                        {bill.adda_id || '-'}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSelectBill(bill)}
                            title="Select Invoice"
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handlePrintBill(bill)}
                            title="Print this bill"
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer"
                          >
                            <Printer size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </AppLayout>
  );
}
