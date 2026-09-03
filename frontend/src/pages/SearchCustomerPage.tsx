import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Search, Users, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { formatDate, getTodayDate, getThreeMonthsAgoDate, formatDateTime, formatCartons } from '@/lib/utils';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { SaleBillRow, CustomerRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

type QuickFilter = 'all' | 'no-adda' | 'no-bilty' | 'no-gp' | 'complete';

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: 'all', label: 'All Bills' },
  { id: 'no-adda', label: 'Without Adda' },
  { id: 'no-bilty', label: 'Without Bilty No.' },
  { id: 'no-gp', label: 'Without Gate Pass No.' },
  { id: 'complete', label: 'Complete' },
];

const isMissing = (v: string | null | undefined) => !v || !v.trim();

export default function SearchCustomerPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [dateFrom, setDateFrom] = useState(getThreeMonthsAgoDate());
  const [dateTo, setDateTo] = useState(getTodayDate());
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  // BA-01: manual (client-typed) and system-generated (IDENTITY bill_id) bill numbers are
  // separate fields, filtered client-side against their own column — same pattern used on
  // the Search & Bilty Adda Updation page.
  const [manualBillNoQuery, setManualBillNoQuery] = useState('');
  const [systemBillNoQuery, setSystemBillNoQuery] = useState('');

  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    api.customers.list({ includeInactive: false }).then(r => { if (r.ok) setCustomers(r.data); });
  }, []);

  const loadBills = useCallback(async () => {
    if (!customerId) { setBills([]); return; }
    setLoading(true);
    const res = await api.saleBills.biltySearch({
      customer_id: Number(customerId),
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });
    if (res.ok) setBills(res.data);
    else setErrorMsg('Failed to load bills: ' + res.error.message);
    setLoading(false);
  }, [customerId, dateFrom, dateTo]);

  useEffect(() => { loadBills(); }, [loadBills]);

  const filteredBills = useMemo(() => {
    let result = bills;

    if (manualBillNoQuery.trim()) {
      const q = manualBillNoQuery.trim().toLowerCase();
      result = result.filter(b => b.bill_no.toLowerCase().includes(q));
    }

    if (systemBillNoQuery.trim()) {
      const q = systemBillNoQuery.trim();
      result = result.filter(b => String(b.bill_id).includes(q));
    }

    switch (quickFilter) {
      case 'no-adda': return result.filter(b => !b.adda_id);
      case 'no-bilty': return result.filter(b => isMissing(b.bilty_no));
      case 'no-gp': return result.filter(b => isMissing(b.gp_no));
      case 'complete': return result.filter(b => b.adda_id && !isMissing(b.bilty_no) && !isMissing(b.gp_no));
      default: return result;
    }
  }, [bills, quickFilter, manualBillNoQuery, systemBillNoQuery]);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.customer_id === Number(customerId)),
    [customers, customerId]
  );

  const missingAdda = bills.filter(b => !b.adda_id).length;
  const missingBilty = bills.filter(b => isMissing(b.bilty_no)).length;
  const missingGp = bills.filter(b => isMissing(b.gp_no)).length;

  const handleExportExcel = () => {
    if (!selectedCustomer) return;
    const headers = ['Date', 'Inv. No (Sys)', 'Manual No.', 'Cartons', 'Pairs', 'Bilty No.', 'Transport Adda', 'GP No.', 'Net Value'];
    const rows = filteredBills.map(b => [
      formatDate(b.bill_date), b.bill_id, b.bill_no, formatCartons(b.total_cartons), b.total_pairs,
      b.bilty_no || 'Missing', b.adda_name || 'Unassigned', b.gp_no || 'Missing', b.net_value
    ]);
    exportRowsToExcel(`search-customer-${selectedCustomer.name.toLowerCase().replace(/\s+/g, '-')}`, headers, rows);
  };

  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', marginBottom: '14px', paddingBottom: '10px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 'bold' }}>CUSTOMER SALE BILLS SEARCH</h2>
          <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: 'bold' }}>{selectedCustomer?.name || 'No customer selected'}</p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#555' }}>
            Period: {dateFrom ? formatDate(dateFrom) : 'All'} — {dateTo ? formatDate(dateTo) : 'All'}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#555' }}>Date of Print: {formatDate(new Date())}</p>
        </div>
      </div>

      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Date</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Inv. No</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Manual No.</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Cartons</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Pairs</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Bilty No.</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Transport Adda</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>GP No.</th>
            <th style={{ border: '1px solid #000', padding: '5px 7px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Net Value</th>
          </tr>
        </thead>
        <tbody>
          {filteredBills.length === 0 ? (
            <tr><td colSpan={9} style={{ border: '1px solid #000', padding: '12px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>No records found.</td></tr>
          ) : filteredBills.map((b, idx) => (
            <tr key={b.bill_id} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
              <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace' }}>{formatDate(b.bill_date)}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', textAlign: 'center' }}>{b.bill_id}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', fontFamily: 'monospace', textAlign: 'center', fontWeight: 'bold' }}>{b.bill_no}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', textAlign: 'right' }}>{formatCartons(b.total_cartons)}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', textAlign: 'right' }}>{b.total_pairs}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', color: isMissing(b.bilty_no) ? '#cc0000' : '#000' }}>{b.bilty_no || 'MISSING'}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', color: !b.adda_id ? '#cc0000' : '#000' }}>{b.adda_name || 'UNASSIGNED'}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', color: isMissing(b.gp_no) ? '#cc0000' : '#000' }}>{b.gp_no || 'MISSING'}</td>
              <td style={{ border: '1px solid #000', padding: '4px 7px', textAlign: 'right', fontFamily: 'monospace' }}>{b.net_value.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', padding: '0 10px' }}>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Prepared By</span>
        </div>
        <div style={{ textAlign: 'center', width: '150px' }}>
          <div style={{ borderBottom: '1px solid #000', height: '30px' }}></div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '5px', display: 'block' }}>Authorized Sign</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000', fontSize: '9px', fontFamily: 'monospace', color: '#333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDateTime(new Date())}</div>
      </div>
    </div>
  );

  return (
    <AppLayout pageTitle="Search Customer">
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Customer Sale Bills Search"
        orientation="landscape"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>

      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        {errorMsg && <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4">{errorMsg}</div>}

        {/* Filter Toolbar */}
        <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-5 shadow-2xs flex flex-col gap-4">
          <h3 className="font-lora font-semibold text-lg text-slate-800 flex items-center gap-2 border-b pb-3">
            <Users size={18} className="text-[#B08D57]" /> Search a Customer's Sale Bills
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Customer <span className="text-rose-500">*</span>
              </label>
              <SearchableSelect
                options={customers.map(c => ({ value: String(c.customer_id), label: c.name }))}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Select customer..."
                searchPlaceholder="Search customers..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">From Date</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="soleria-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">To Date</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="soleria-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Manual Bill No.</label>
              <input
                type="text"
                placeholder="Client-typed bill no..."
                value={manualBillNoQuery}
                onChange={e => setManualBillNoQuery(e.target.value)}
                className="soleria-input"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">System Bill No. (Inv #)</label>
              <input
                type="text"
                placeholder="System-generated Inv #..."
                value={systemBillNoQuery}
                onChange={e => setSystemBillNoQuery(e.target.value)}
                className="soleria-input"
              />
            </div>
          </div>

          {/* Predefined Quick Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 mt-1 border-slate-100">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mr-1">
              <Search size={13} /> Quick Filter:
            </span>
            {QUICK_FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setQuickFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none ${
                  quickFilter === f.id
                    ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!customerId ? (
          <div className="card-white bg-white border border-slate-200/80 rounded-2xl p-12 text-center text-slate-400 text-sm">
            Select a customer above to search their sale bills.
          </div>
        ) : (
          <>
            {/* Results Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-slate-600">
                  Found <span className="text-[var(--brand-navy)] font-bold">{filteredBills.length}</span> bill{filteredBills.length === 1 ? '' : 's'}
                </span>
                {missingAdda > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-200 font-semibold">
                    {missingAdda} missing adda
                  </span>
                )}
                {missingBilty > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 font-semibold">
                    {missingBilty} missing bilty
                  </span>
                )}
                {missingGp > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                    {missingGp} missing gate pass
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsPreviewOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
              >
                <Eye size={14} /> Show Print Preview
              </button>
            </div>

            {/* Results Table */}
            <div className="card-white bg-white border border-slate-200/80 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3 pl-4">Date</th>
                      <th className="p-3 text-center">Inv. No (Sys)</th>
                      <th className="p-3 text-center">Manual No.</th>
                      <th className="p-3 text-right">Cartons</th>
                      <th className="p-3 text-right">Pairs</th>
                      <th className="p-3">Bilty No.</th>
                      <th className="p-3">Transport Adda</th>
                      <th className="p-3">GP No.</th>
                      <th className="p-3 text-right">Net Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="text-center p-8 text-slate-400 text-sm">Loading…</td></tr>
                    ) : filteredBills.length === 0 ? (
                      <tr><td colSpan={9} className="text-center p-8 text-slate-400 text-sm">No bills match this filter.</td></tr>
                    ) : (
                      filteredBills.map(b => (
                        <tr key={b.bill_id} className="border-b text-sm hover:bg-slate-50/50" style={{ borderColor: 'var(--border-table)' }}>
                          <td className="p-3 pl-4 font-mono">{formatDate(b.bill_date)}</td>
                          <td className="p-3 text-center font-mono">{b.bill_id}</td>
                          <td className="p-3 text-center font-mono font-semibold">{b.bill_no}</td>
                          <td className="p-3 text-right font-mono">{formatCartons(b.total_cartons)}</td>
                          <td className="p-3 text-right font-mono">{b.total_pairs}</td>
                          <td className="p-3 font-mono">
                            {b.bilty_no ? (
                              <span className="font-semibold text-slate-800">{b.bilty_no}</span>
                            ) : (
                              <span className="text-red-500 italic text-xs">Missing</span>
                            )}
                          </td>
                          <td className="p-3">
                            {b.adda_id ? (
                              <span className="text-slate-700">{b.adda_name}</span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">Unassigned</span>
                            )}
                          </td>
                          <td className="p-3 font-mono">
                            {b.gp_no ? (
                              <span className="font-semibold text-slate-800">{b.gp_no}</span>
                            ) : (
                              <span className="text-amber-600 italic text-xs">Missing</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono font-semibold" style={{ color: 'var(--brand-gold)' }}>
                            {b.net_value.toLocaleString('en-US')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
