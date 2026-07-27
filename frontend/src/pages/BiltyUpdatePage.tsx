import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import type { SaleBill } from '@/types';
import { Search, Edit2, RefreshCw, Printer, FileDown, FileSpreadsheet } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';

export default function BiltyUpdatePage() {
  const { state, dispatch } = useApp();

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
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [updateBillNo, setUpdateBillNo] = useState('');
  const [updateBiltyNo, setUpdateBiltyNo] = useState('');
  const [updateAddaId, setUpdateAddaId] = useState('');

  // Notification state
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Select a bill from table
  const handleSelectBill = (bill: SaleBill) => {
    setSelectedBillId(bill.id);
    setUpdateBillNo(bill.billNo);
    setUpdateBiltyNo(bill.biltyNo || '');
    setUpdateAddaId(bill.addaId || state.addas[0]?.id || '');
    setErrorMsg('');
  };

  // Perform Update
  const handleUpdateBilty = (e: React.FormEvent) => {
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

    dispatch({
      type: 'UPDATE_BILTY_INFO',
      billId: selectedBillId,
      biltyNo: updateBiltyNo,
      addaId: updateAddaId
    });

    setSuccessMsg(`Bilty updated successfully for Bill No: ${updateBillNo}`);
    setTimeout(() => setSuccessMsg(''), 3000);
    
    // Clear selection
    setSelectedBillId(null);
    setUpdateBillNo('');
    setUpdateBiltyNo('');
    setErrorMsg('');
  };

  // Print results
  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const headers = ['Invoice Date', 'Inv. No (Sys)', 'Manual No.', 'Customer Name', 'Sub Customer Name', 'Bilty No.', 'Transport Adda', 'Adda Code'];
    const rows = filteredInvoices.map(bill => {
      const custName = state.customers.find(c => c.id === bill.customerId)?.name || '-';
      const subCustName = bill.subCustomerId ? state.subCustomers.find(sc => sc.id === bill.subCustomerId)?.name : 'SAME (Direct)';
      const addaName = bill.addaId ? state.addas.find(ad => ad.id === bill.addaId)?.name : 'Not Assigned';
      return [bill.date, bill.id, bill.billNo, custName, subCustName || '-', bill.biltyNo || '-', addaName || '-', bill.addaId || '-'];
    });
    exportRowsToExcel('bilty-adda-search', headers, rows);
  };

  // Filter and Sort Logic
  const filteredInvoices = useMemo(() => {
    let result = [...state.saleBills];

    // Filter by Date
    if (startDate) {
      result = result.filter(b => b.date >= startDate);
    }
    if (endDate) {
      result = result.filter(b => b.date <= endDate);
    }

    // Filter by Bill No
    if (billNoQuery.trim()) {
      result = result.filter(b => b.billNo.includes(billNoQuery.trim()));
    }

    // Filter by Customer Name
    if (customerQuery.trim()) {
      const q = customerQuery.toLowerCase();
      result = result.filter(b => {
        const custName = state.customers.find(c => c.id === b.customerId)?.name.toLowerCase() || '';
        return custName.includes(q);
      });
    }

    // Filter by Sub-customer Name
    if (subCustomerQuery.trim()) {
      const q = subCustomerQuery.toLowerCase();
      result = result.filter(b => {
        if (!b.subCustomerId) return false;
        const subName = state.subCustomers.find(sc => sc.id === b.subCustomerId)?.name.toLowerCase() || '';
        return subName.includes(q);
      });
    }

    // Filter by Bilty / Adda Status
    if (biltyStatusFilter === 'no-bilty') {
      result = result.filter(b => !b.biltyNo || b.biltyNo === '0' || b.biltyNo.trim() === '');
    } else if (biltyStatusFilter === 'no-adda') {
      result = result.filter(b => !b.addaId);
    } else if (biltyStatusFilter === 'has-bilty') {
      result = result.filter(b => b.biltyNo && b.biltyNo !== '0' && b.biltyNo.trim() !== '');
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'inv-no') {
        return a.id.localeCompare(b.id);
      } else {
        return a.billNo.localeCompare(b.billNo);
      }
    });

    return result;
  }, [state.saleBills, state.customers, state.subCustomers, startDate, endDate, billNoQuery, customerQuery, subCustomerQuery, biltyStatusFilter, sortBy]);

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
                <select
                  value={updateAddaId}
                  onChange={e => setUpdateAddaId(e.target.value)}
                  className="soleria-input cursor-pointer"
                >
                  <option value="">Select Adda...</option>
                  {state.addas.map(ad => (
                    <option key={ad.id} value={ad.id}>{ad.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="btn-gold w-full mt-2"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t" style={{ borderColor: 'var(--border-table)' }}>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">Bilty Status</span>
                <div className="flex flex-wrap gap-4 text-xs font-medium">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={biltyStatusFilter === 'all'} onChange={() => setBiltyStatusFilter('all')} className="accent-slate-800" />
                    All Invoices
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={biltyStatusFilter === 'no-bilty'} onChange={() => setBiltyStatusFilter('no-bilty')} className="accent-slate-800" />
                    Without Bilty
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={biltyStatusFilter === 'no-adda'} onChange={() => setBiltyStatusFilter('no-adda')} className="accent-slate-800" />
                    Without Adda
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={biltyStatusFilter === 'has-bilty'} onChange={() => setBiltyStatusFilter('has-bilty')} className="accent-slate-800" />
                    With Bilty
                  </label>
                </div>
              </div>
              <div>
                <span className="block text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">Sort Results By</span>
                <div className="flex gap-4 text-xs font-medium">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={sortBy === 'inv-no'} onChange={() => setSortBy('inv-no')} className="accent-slate-800" />
                    Invoice No.
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={sortBy === 'bill-no'} onChange={() => setSortBy('bill-no')} className="accent-slate-800" />
                    Manual Bill No.
                  </label>
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
            <button onClick={handlePrint} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <Printer size={14} /> Print Report
            </button>
            <button onClick={exportToPDF} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <FileDown size={14} /> Export PDF
            </button>
            <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3 py-1.5 text-xs">
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
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-8 text-slate-400 text-sm">
                    No invoices match your selected search criteria.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(bill => {
                  const custName = state.customers.find(c => c.id === bill.customerId)?.name || '-';
                  const subCustName = bill.subCustomerId ? state.subCustomers.find(sc => sc.id === bill.subCustomerId)?.name : 'SAME (Direct)';
                  const addaName = bill.addaId ? state.addas.find(ad => ad.id === bill.addaId)?.name : 'Not Assigned';
                  const isSelected = selectedBillId === bill.id;

                  return (
                    <tr
                      key={bill.id}
                      className={`border-b text-sm transition-colors ${isSelected ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-slate-50/50'}`}
                      style={{ borderColor: 'var(--border-table)' }}
                    >
                      <td className="p-3 pl-4 font-mono">{bill.date}</td>
                      <td className="p-3 text-center font-mono">{bill.id}</td>
                      <td className="p-3 text-center font-mono font-semibold">{bill.billNo}</td>
                      <td className="p-3 font-semibold text-slate-700">{custName}</td>
                      <td className="p-3 text-slate-600">{subCustName}</td>
                      <td className="p-3 font-mono">
                        {bill.biltyNo ? (
                          <span className="font-semibold text-slate-800">{bill.biltyNo}</span>
                        ) : (
                          <span className="text-red-500 italic text-xs">Missing</span>
                        )}
                      </td>
                      <td className="p-3">
                        {bill.addaId ? (
                          <span className="text-slate-700">{addaName}</span>
                        ) : (
                          <span className="text-slate-400 italic text-xs">Unassigned</span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono text-xs text-slate-500">
                        {bill.addaId || '-'}
                      </td>
                      <td className="p-3 text-center" data-no-print>
                        <button
                          onClick={() => handleSelectBill(bill)}
                          className="text-blue-600 hover:text-blue-800 p-1 flex items-center gap-1 mx-auto text-xs font-semibold"
                        >
                          <Edit2 size={12} /> Select
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
