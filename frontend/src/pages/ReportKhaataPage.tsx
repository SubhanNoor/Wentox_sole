import { useState, useEffect, useMemo, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { formatCurrency } from '@/context/AppContext';
import * as api from '@/lib/api';
import type { CustomerRow, SaleBillRow, SaleReturnRow } from '@/lib/api';
import { Search, Printer, Calendar, FileText, User, ChevronDown, Check, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import { ReportContainer } from '@/components/reports/ReportContainer';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ReportTable, type ColumnDef } from '@/components/reports/ReportTable';
import { ReportFooter } from '@/components/reports/ReportFooter';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

interface KhaataEntry {
  date: string;
  sysId: string | number;
  docNo: string;
  type: 'SALE' | 'RETURN';
  description: string;
  cartons: number;
  pairs: number;
  debit: number;
  credit: number;
  balance: number;
}

export function ReportKhaataContent() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [bills, setBills] = useState<SaleBillRow[]>([]);
  const [returns, setReturns] = useState<SaleReturnRow[]>([]);
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api.listCustomers();
      if (res.ok) setCustomers(res.data);
    })();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setIsCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selectedCustomerId) {
      setBills([]);
      setReturns([]);
      return;
    }
    (async () => {
      const custId = Number(selectedCustomerId);
      const [bRes, rRes] = await Promise.all([
        api.saleBills.list({ customer_id: custId }),
        api.saleReturns.list({ customer_id: custId })
      ]);
      if (bRes.ok) setBills(bRes.data);
      if (rRes.ok) setReturns(rRes.data);
    })();
  }, [selectedCustomerId]);

  const selectedCustomerObj = useMemo(() => {
    return customers.find(c => c.customer_id === Number(selectedCustomerId));
  }, [customers, selectedCustomerId]);

  const khaataEntries = useMemo(() => {
    if (!selectedCustomerId) return [];

    const entries: { date: string; sysId: string | number; docNo: string; type: 'SALE' | 'RETURN'; description: string; cartons: number; pairs: number; debit: number; credit: number }[] = [];

    bills.forEach(b => {
      entries.push({
        date: b.bill_date,
        sysId: b.bill_id,
        docNo: b.bill_no,
        type: 'SALE',
        description: `Sale Invoice #${b.bill_no}`,
        cartons: b.total_cartons,
        pairs: b.total_pairs,
        debit: b.net_value,
        credit: 0
      });
    });

    returns.forEach(r => {
      entries.push({
        date: r.return_date,
        sysId: r.return_id,
        docNo: r.bill_no,
        type: 'RETURN',
        description: `Sale Return #${r.bill_no}`,
        cartons: r.total_cartons,
        pairs: r.total_pairs,
        debit: 0,
        credit: r.net_value
      });
    });

    entries.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    return entries.map(e => {
      runningBalance += (e.debit - e.credit);
      return {
        ...e,
        balance: runningBalance
      };
    });
  }, [bills, returns, selectedCustomerId]);

  const totals = useMemo(() => {
    let cartons = 0;
    let pairs = 0;
    let debit = 0;
    let credit = 0;
    khaataEntries.forEach(e => {
      cartons += e.cartons;
      pairs += e.pairs;
      debit += e.debit;
      credit += e.credit;
    });
    return { cartons, pairs, debit, credit, closingBalance: debit - credit };
  }, [khaataEntries]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return customers;
    return customers.filter(c => c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()));
  }, [customers, customerSearchQuery]);

  const handleExportExcel = () => {
    if (!selectedCustomerObj) return;
    const headers = ['Date', 'Sys ID', 'Doc No.', 'Type', 'Description', 'Cartons', 'Pairs', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)'];
    const rows = khaataEntries.map(e => [
      e.date.slice(0, 10),
      e.sysId,
      e.docNo,
      e.type,
      e.description,
      e.cartons,
      e.pairs,
      e.debit,
      e.credit,
      e.balance
    ]);
    exportRowsToExcel(`khaata-ledger-${selectedCustomerObj.name}`, headers, rows);
  };

  const columns: ColumnDef<KhaataEntry>[] = [
    { key: 'date', header: 'Date', width: '110px', accessor: r => <span className="font-mono">{r.date.slice(0, 10)}</span> },
    { key: 'sysId', header: 'Sys ID', align: 'center', width: '80px', accessor: r => <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{r.sysId}</span> },
    { key: 'docNo', header: 'Doc No.', align: 'center', width: '90px', accessor: r => <span className="font-mono font-bold">{r.docNo}</span> },
    { key: 'type', header: 'Type', align: 'center', width: '80px', accessor: r => (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${r.type === 'SALE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
        {r.type}
      </span>
    )},
    { key: 'description', header: 'Description', accessor: r => <span className="font-medium text-slate-800">{r.description}</span> },
    { key: 'cartons', header: 'Cartons', align: 'right', width: '75px', accessor: r => <span className="font-mono font-bold">{r.cartons}</span> },
    { key: 'pairs', header: 'Pairs', align: 'right', width: '80px', accessor: r => <span className="font-mono">{r.pairs}</span> },
    { key: 'debit', header: 'Debit (Rs.)', align: 'right', width: '110px', accessor: r => <span className="font-mono text-emerald-700 font-bold">{r.debit ? formatCurrency(r.debit) : '-'}</span> },
    { key: 'credit', header: 'Credit (Rs.)', align: 'right', width: '110px', accessor: r => <span className="font-mono text-rose-700 font-bold">{r.credit ? formatCurrency(r.credit) : '-'}</span> },
    { key: 'balance', header: 'Balance (Rs.)', align: 'right', width: '120px', accessor: r => <span className="font-mono font-bold text-slate-900">{formatCurrency(r.balance)}</span> },
  ];

  const renderPrintableReport = () => (
    <ReportContainer orientation="portrait">
      <ReportHeader
        title="CUSTOMER KHAATA LEDGER STATEMENT"
        subtitle={`Party Khaata Record: ${selectedCustomerObj?.name || 'All Customers'}`}
        metadata={[
          { label: 'Customer Name', value: selectedCustomerObj?.name || 'All' },
          { label: 'Customer ID', value: selectedCustomerObj ? `#${selectedCustomerObj.customer_id}` : 'All' },
          { label: 'Total Invoices', value: bills.length },
          { label: 'Total Returns', value: returns.length },
        ]}
      />

      <ReportTable
        columns={columns}
        data={khaataEntries}
        rowKeyExtractor={(r, idx) => `${r.type}-${r.sysId}-${idx}`}
        summaryRow={(
          <tr className="bg-slate-100 font-bold border-t-2 border-slate-900 text-xs font-mono">
            <td colSpan={5} className="py-2.5 px-3 text-left font-bold uppercase tracking-wider">TOTAL CUMULATIVE SUM</td>
            <td className="py-2.5 px-3 text-right">{totals.cartons}</td>
            <td className="py-2.5 px-3 text-right">{totals.pairs.toLocaleString()}</td>
            <td className="py-2.5 px-3 text-right text-emerald-800">{formatCurrency(totals.debit)}</td>
            <td className="py-2.5 px-3 text-right text-rose-800">{formatCurrency(totals.credit)}</td>
            <td className="py-2.5 px-3 text-right text-slate-950 underline">{formatCurrency(totals.closingBalance)}</td>
          </tr>
        )}
      />

      <ReportFooter printedBy="Admin Operator" notes="Computer generated customer statement." />
    </ReportContainer>
  );

  return (
    <>
      <div className="mx-auto print:hidden px-2" style={{ maxWidth: 1400 }}>
        {/* Selector Card */}
        <div className="card-white p-5 bg-white border border-slate-200/80 rounded-2xl mb-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              <User className="text-[var(--brand-navy)]" size={20} />
              <div className="flex-1 relative" ref={customerDropdownRef}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Select Customer Party
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomerDropdownOpen(!isCustomerDropdownOpen)}
                  className="flex items-center justify-between w-full px-4 py-2.5 bg-slate-50/60 hover:bg-white border border-slate-200 hover:border-[var(--brand-gold)] rounded-xl text-sm font-medium transition-all cursor-pointer shadow-2xs"
                >
                  <span className="truncate text-slate-800 font-semibold">
                    {selectedCustomerObj ? `${selectedCustomerObj.name} (#${selectedCustomerObj.customer_id})` : 'Select a customer...'}
                  </span>
                  <ChevronDown className={`text-slate-400 transition-transform duration-200 ${isCustomerDropdownOpen ? 'rotate-180 text-[var(--brand-gold)]' : ''}`} size={18} />
                </button>

                {isCustomerDropdownOpen && (
                  <div className="absolute left-0 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search customer name..."
                          value={customerSearchQuery}
                          onChange={e => setCustomerSearchQuery(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-[var(--brand-gold)]"
                        />
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <div className="p-3 text-xs text-slate-400 text-center">No customers found</div>
                      ) : (
                        filteredCustomers.map(c => (
                          <button
                            key={c.customer_id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomerId(String(c.customer_id));
                              setIsCustomerDropdownOpen(false);
                            }}
                            className={`flex items-center justify-between w-full px-4 py-2.5 text-xs text-left transition-colors cursor-pointer ${selectedCustomerId === String(c.customer_id) ? 'bg-[var(--brand-gold)] text-white font-semibold' : 'hover:bg-[#fbf7f0] text-slate-700'}`}
                          >
                            <span>{c.name} <span className="opacity-70 font-mono">(#{c.customer_id})</span></span>
                            {selectedCustomerId === String(c.customer_id) && <Check size={14} />}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {selectedCustomerId && (
              <div className="flex items-center gap-2 self-end">
                <button
                  onClick={() => setIsPreviewOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
                >
                  <Eye size={15} /> Show Print Preview
                </button>
                <button onClick={() => setIsPreviewOpen(true)} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-xs cursor-pointer">
                  <Printer size={15} /> Print Document
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-xs cursor-pointer">
                  <FileText size={15} /> Export Excel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Khaata Content */}
        {selectedCustomerId && selectedCustomerObj ? (
          <div className="card-white p-6 bg-white border border-slate-200/80 shadow-md rounded-2xl">
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div>
                <h3 className="font-lora font-bold text-xl text-slate-900">
                  {selectedCustomerObj.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Customer ID: #{selectedCustomerObj.customer_id} • Total Transactions: {khaataEntries.length}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Closing Balance</span>
                <span className="text-2xl font-bold font-mono text-[var(--brand-gold)]">{formatCurrency(totals.closingBalance)}</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
              <table className="w-full text-left border-collapse text-sm font-inter">
                <thead>
                  <tr className="bg-slate-50/80 border-b text-xs font-semibold uppercase tracking-wider text-slate-500 border-slate-200">
                    <th className="p-3.5 pl-4">Date</th>
                    <th className="p-3.5 text-center">Sys ID</th>
                    <th className="p-3.5 text-center">Doc No.</th>
                    <th className="p-3.5 text-center">Type</th>
                    <th className="p-3.5">Description</th>
                    <th className="p-3.5 text-right">Cartons</th>
                    <th className="p-3.5 text-right">Pairs</th>
                    <th className="p-3.5 text-right">Debit</th>
                    <th className="p-3.5 text-right">Credit</th>
                    <th className="p-3.5 text-right pr-4">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {khaataEntries.map((e, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3.5 pl-4 font-mono text-slate-600">{e.date.slice(0, 10)}</td>
                      <td className="p-3.5 text-center font-mono text-xs">{e.sysId}</td>
                      <td className="p-3.5 text-center font-mono font-bold text-slate-800">{e.docNo}</td>
                      <td className="p-3.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${e.type === 'SALE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {e.type}
                        </span>
                      </td>
                      <td className="p-3.5 font-medium text-slate-800">{e.description}</td>
                      <td className="p-3.5 text-right font-mono font-semibold">{e.cartons}</td>
                      <td className="p-3.5 text-right font-mono">{e.pairs}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-emerald-700">{e.debit ? formatCurrency(e.debit) : '-'}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-rose-700">{e.credit ? formatCurrency(e.credit) : '-'}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-slate-900 pr-4">{formatCurrency(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card-white p-12 text-center text-slate-400 bg-white border border-slate-200/80 rounded-2xl">
            <Calendar size={48} className="mx-auto mb-3 text-slate-300" />
            <p className="font-lora text-lg font-semibold text-slate-600">Select a Customer Party</p>
            <p className="text-xs text-slate-400 mt-1">Choose a customer from the dropdown above to generate their complete Khaata Ledger Statement.</p>
          </div>
        )}
      </div>

      {/* Native @media print container */}
      <div className="hidden print:block">
        {renderPrintableReport()}
      </div>

      {/* Print Preview Modal */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={`Customer Khaata Ledger - ${selectedCustomerObj?.name || ''}`}
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableReport()}
      </ReportPrintPreviewModal>
    </>
  );
}

export default function ReportKhaataPage() {
  return (
    <AppLayout pageTitle="Customer Khaata Ledger">
      <ReportKhaataContent />
    </AppLayout>
  );
}
