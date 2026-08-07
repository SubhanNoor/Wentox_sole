import { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Search, Edit2, RefreshCw, Printer, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { SaleBillRow, AddaRow } from '@/lib/api';

export default function BiltyUpdatePage() {
  // Search Filters State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [subCustomerQuery, setSubCustomerQuery] = useState('');
  const [billNoQuery, setBillNoQuery] = useState('');

  // Radio Filters State
  const [biltyStatusFilter, setBiltyStatusFilter] = useState<'all' | 'no-bilty' | 'no-adda' | 'has-bilty'>('all');
  const [sortBy, setSortBy] = useState<'inv-no' | 'bill-no'>('inv-no');

  // Selected Invoice for Updation
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [updateBillNo, setUpdateBillNo] = useState('');
  const [updateBiltyNo, setUpdateBiltyNo] = useState('');
  const [updateAddaId, setUpdateAddaId] = useState('');

  // Notification state
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [addas, setAddas] = useState<AddaRow[]>([]);
  const [invoices, setInvoices] = useState<SaleBillRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.listAddas().then(r => { if (r.ok) setAddas(r.data); }); }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const res = await api.saleBills.biltySearch({
      date_from: startDate || undefined,
      date_to: endDate || undefined,
      bill_no: billNoQuery.trim() || undefined,
    });
    if (res.ok) setInvoices(res.data);
    setLoading(false);
  }, [startDate, endDate, billNoQuery]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // Select a bill from table
  const handleSelectBill = (bill: SaleBillRow) => {
    setSelectedBillId(bill.bill_id);
    setUpdateBillNo(bill.bill_no);
    setUpdateBiltyNo(bill.bilty_no || '');
    setUpdateAddaId(bill.adda_id ? String(bill.adda_id) : (addas[0] ? String(addas[0].adda_id) : ''));
    setErrorMsg('');
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

  // Print results
  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const headers = ['Invoice Date', 'Inv. No (Sys)', 'Manual No.', 'Customer Name', 'Sub Customer Name', 'Bilty No.', 'Transport Adda', 'Adda Code'];
    const rows = filteredInvoices.map(bill => [
      bill.bill_date, bill.bill_id, bill.bill_no,
      bill.customer_name || '-',
      bill.sub_customer_name || 'SAME (Direct)',
      bill.bilty_no || '-',
      bill.adda_name || 'Not Assigned',
      bill.adda_id || '-'
    ]);
    exportRowsToExcel('bilty-adda-search', headers, rows);
  };

  // Client-side filters not covered by biltySearch() (customer/sub-customer name substring, bilty
  // status) + sorting — biltySearch() itself only takes customer_id/sub_customer_id/bill_no/dates.
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

    if (biltyStatusFilter === 'no-bilty') {
      result = result.filter(b => !b.bilty_no || b.bilty_no.trim() === '');
    } else if (biltyStatusFilter === 'no-adda') {
      result = result.filter(b => !b.adda_id);
    } else if (biltyStatusFilter === 'has-bilty') {
      result = result.filter(b => b.bilty_no && b.bilty_no.trim() !== '');
    }

    result.sort((a, b) => {
      if (sortBy === 'inv-no') {
        return a.bill_id - b.bill_id;
      } else {
        return a.bill_no.localeCompare(b.bill_no);
      }
    });

    return result;
  }, [invoices, customerQuery, subCustomerQuery, biltyStatusFilter, sortBy]);

  return (
    <AppLayout pageTitle="Search & Bilty Adda Updation">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>

        {/* Success/Error Alerts */}
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
        )}
        {errorMsg && (
          <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
        )}

        {/* Update Form & Search Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6" data-no-print>

          {/* Update Bilty Box */}
          <div className="card-white p-5 bg-white border flex flex-col gap-4">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 text-slate-800 flex items-center gap-2">
              <RefreshCw size={18} className="text-amber-600" /> Bilty Info Update
            </h3>
            <form onSubmit={handleUpdateBilty} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Selected Bill No.
                </label>
                <input
                  type="text"
                  value={updateBillNo}
                  readOnly
                  disabled
                  placeholder="Click an invoice row to select..."
                  className="soleria-input bg-slate-50 text-slate-500 font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Bilty Number
                </label>
                <input
                  type="text"
                  value={updateBiltyNo}
                  onChange={e => setUpdateBiltyNo(e.target.value)}
                  placeholder="Enter Bilty No..."
                  className="soleria-input"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Transport Adda
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
                className="btn-gold w-full mt-2 cursor-pointer"
                disabled={!selectedBillId}
              >
                Update Bilty &amp; Adda
              </button>
            </form>
          </div>

          {/* Search Filters Box */}
          <div className="card-white lg:col-span-2 p-5 bg-white border flex flex-col gap-4">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 text-slate-800 flex items-center gap-2">
              <Search size={18} className="text-blue-600" /> Search Filters
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="soleria-input py-1.5" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="soleria-input py-1.5" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Bill Number</label>
                <input type="text" placeholder="Bill No..." value={billNoQuery} onChange={e => setBillNoQuery(e.target.value)} className="soleria-input py-1.5" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Customer Name</label>
                <input type="text" placeholder="Search customer..." value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} className="soleria-input py-1.5" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Sub Customer Name</label>
                <input type="text" placeholder="Search sub customer..." value={subCustomerQuery} onChange={e => setSubCustomerQuery(e.target.value)} className="soleria-input py-1.5" />
              </div>
            </div>

            {/* Radio Sorting / Filters Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'var(--border-table)' }}>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">BILTY STATUS</span>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'all', label: 'All Invoices' },
                    { id: 'no-bilty', label: 'Without Bilty' },
                    { id: 'no-adda', label: 'Without Adda' },
                    { id: 'has-bilty', label: 'With Bilty' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBiltyStatusFilter(opt.id as 'all' | 'no-bilty' | 'no-adda' | 'has-bilty')}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-all select-none ${biltyStatusFilter === opt.id
                          ? 'bg-[#111c2a] text-white border-[#111c2a] shadow-sm font-bold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-300" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">SORT RESULTS BY</span>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: 'inv-no', label: 'Invoice No.' },
                    { id: 'bill-no', label: 'Manual Bill No.' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSortBy(opt.id as 'inv-no' | 'bill-no')}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-all select-none ${sortBy === opt.id
                          ? 'bg-[#111c2a] text-white border-[#111c2a] shadow-sm font-bold'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-300" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Results Toolbar */}
        <div className="flex items-center justify-between mb-4" data-no-print>
          <span className="text-sm font-semibold text-slate-600">
            Found {filteredInvoices.length} invoices matching filters
          </span>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer">
              <Printer size={14} /> Print Report
            </button>
            <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer">
              <FileDown size={14} /> Export PDF
            </button>
            <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer">
              <FileSpreadsheet size={14} /> Export Excel
            </button>
          </div>
        </div>

        {/* Invoices Table */}
        <div className="card-white bg-white border">
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
                <th className="p-3 text-center" style={{ width: '70px' }} data-no-print>Action</th>
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
                      <td className="p-3 pl-4 font-mono">{bill.bill_date}</td>
                      <td className="p-3 text-center font-mono">{bill.bill_id}</td>
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
                      <td className="p-3 text-center" data-no-print>
                        <button
                          onClick={() => handleSelectBill(bill)}
                          title="Select Invoice"
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-[var(--brand-navy)] transition-colors cursor-pointer mx-auto"
                        >
                          <Edit2 size={15} />
                        </button>
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
