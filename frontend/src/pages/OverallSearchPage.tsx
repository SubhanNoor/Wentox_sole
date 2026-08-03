import { useState, useMemo } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Search, Printer, FileDown, FileSpreadsheet, ArrowLeft, Users, User, Truck, HardHat, Landmark, BookOpen } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

type EntityType = 'customer' | 'vendor' | 'employee' | 'subcustomer' | 'account';

interface PersonEntity {
  id: string;
  name: string;
  type: EntityType;
  typeLabel: string;
  subtitle: string;
  phone?: string;
  city?: string;
  baId?: string;
  rawObj: any;
}

interface GenericLedgerRow {
  date: string;
  type: string;
  ref: string;
  narration: string;
  debit: number;
  credit: number;
}

export default function OverallSearchPage() {
  const { state } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState<'all' | EntityType>('all');
  const [selectedPerson, setSelectedPerson] = useState<PersonEntity | null>(null);

  const [fromDate, setFromDate] = useState(getThreeMonthsAgoDate());
  const [toDate, setToDate] = useState(getTodayDate());

  // ── Unified Search Directory ────────────────────────────────────────────────
  const allPeople = useMemo<PersonEntity[]>(() => {
    const list: PersonEntity[] = [];

    // 1. Customers
    state.customers.forEach(c => {
      const city = state.cities.find(ci => ci.id === c.cityId)?.name || '';
      list.push({
        id: c.id,
        name: c.name,
        type: 'customer',
        typeLabel: 'Customer',
        subtitle: `Code: ${c.id}${city ? ` • ${city}` : ''}`,
        city,
        baId: c.baId,
        rawObj: c
      });
    });

    // 2. Vendors
    state.vendors.forEach(v => {
      list.push({
        id: v.id,
        name: v.name,
        type: 'vendor',
        typeLabel: 'Vendor Partner',
        subtitle: `Code: ${v.id}${v.city ? ` • ${v.city}` : ''}`,
        phone: v.phone,
        city: v.city,
        baId: v.baId,
        rawObj: v
      });
    });

    // 3. Employees / Workers
    state.employees.forEach(e => {
      const city = state.cities.find(ci => ci.id === e.cityId)?.name || '';
      list.push({
        id: e.id,
        name: e.name,
        type: 'employee',
        typeLabel: e.employeeType === 'WORKER' ? 'Worker (Piece Rate)' : 'Staff (Salaried)',
        subtitle: `Code: ${e.id}${city ? ` • ${city}` : ''}`,
        phone: e.phone,
        city,
        baId: e.baId,
        rawObj: e
      });
    });

    // 4. Sub-Customers
    state.subCustomers.forEach(s => {
      list.push({
        id: s.id,
        name: s.name,
        type: 'subcustomer',
        typeLabel: 'Sub-Customer',
        subtitle: `Sub-Customer Code: ${s.id}`,
        rawObj: s
      });
    });

    // 5. Business Accounts
    state.businessAccounts.forEach(ba => {
      const chartName = state.chartAccounts.find(ca => ca.id === ba.controlId)?.name || '';
      list.push({
        id: ba.id,
        name: ba.name,
        type: 'account',
        typeLabel: 'Business Account',
        subtitle: `BA Code: ${ba.id}${chartName ? ` • ${chartName}` : ''}`,
        baId: ba.id,
        rawObj: ba
      });
    });

    return list;
  }, [state]);

  const filteredPeople = useMemo(() => {
    return allPeople.filter(p => {
      if (entityFilter !== 'all' && p.type !== entityFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        (p.phone && p.phone.toLowerCase().includes(q))
      );
    });
  }, [allPeople, entityFilter, searchQuery]);

  // ── Unified Ledger Generator ────────────────────────────────────────────────
  const personLedgerEntries = useMemo<GenericLedgerRow[]>(() => {
    if (!selectedPerson) return [];

    const entries: GenericLedgerRow[] = [];
    const p = selectedPerson;

    if (p.type === 'customer') {
      // Customer Ledger
      const custId = p.id;
      state.saleBills.filter(b => b.customerId === custId).forEach(b => {
        const cartons = b.items.reduce((s, i) => s + (i.cartons || 0), 0);
        const pairs = b.items.reduce((s, i) => s + (i.pairs || 0), 0);
        entries.push({
          date: b.date,
          type: 'Sale Bill',
          ref: b.billNo || b.id,
          narration: `Sale Bill (${cartons} ctn / ${pairs} pairs)`,
          debit: b.totalValue,
          credit: 0
        });
      });

      state.saleReturns.filter(r => r.customerId === custId).forEach(r => {
        const cartons = r.items.reduce((s, i) => s + (i.cartons || 0), 0);
        const pairs = r.items.reduce((s, i) => s + (i.pairs || 0), 0);
        const totalVal = r.items.reduce((s, i) => s + (i.value || 0), 0) - (r.invoiceDiscount || 0);
        entries.push({
          date: r.date,
          type: 'Sale Return',
          ref: r.billNo || r.id,
          narration: `Sale Return (${cartons} ctn / ${pairs} pairs)`,
          debit: 0,
          credit: totalVal
        });
      });

      state.receipts.filter(rc => rc.customerId === custId).forEach(rc => {
        entries.push({
          date: rc.date,
          type: 'Receipt (Jamma)',
          ref: rc.id,
          narration: rc.paymentMode === 'Cheque' ? `Cheque #${rc.chequeNo || ''}` : `Cash Receipt (${rc.remarks || 'Cash'})`,
          debit: 0,
          credit: rc.amount
        });
        if (rc.commission && rc.commission > 0) {
          entries.push({
            date: rc.date,
            type: 'Commission',
            ref: rc.id,
            narration: 'Invoice Discount / Commission',
            debit: 0,
            credit: rc.commission
          });
        }
        if (rc.chequeStatus === 'BOUNCED' && rc.bouncedDate) {
          entries.push({
            date: rc.bouncedDate,
            type: 'Cheque Bounced',
            ref: rc.id,
            narration: `Cheque #${rc.chequeNo || ''} bounced — reverses receipt`,
            debit: rc.amount + (rc.commission || 0),
            credit: 0
          });
        }
        if (rc.chequeStatus === 'RETURNED' && rc.returnedDate) {
          entries.push({
            date: rc.returnedDate,
            type: 'Cheque Returned',
            ref: rc.id,
            narration: `Cheque #${rc.chequeNo || ''} returned to sender — reverses receipt`,
            debit: rc.amount + (rc.commission || 0),
            credit: 0
          });
        }
      });
    } else if (p.type === 'vendor') {
      // Vendor Ledger
      const vendId = p.id;
      state.purchases.filter(pr => pr.vendorId === vendId).forEach(pr => {
        const matName = pr.items[0]?.materialName || 'Goods';
        entries.push({
          date: pr.date,
          type: 'Purchase',
          ref: pr.id,
          narration: `Material Purchase (${matName})`,
          debit: pr.totalValue,
          credit: 0
        });
      });

      state.purchaseReturns.filter(prr => prr.vendorId === vendId).forEach(prr => {
        entries.push({
          date: prr.date,
          type: 'Purchase Return',
          ref: prr.id,
          narration: `Material Purchase Return`,
          debit: 0,
          credit: prr.totalValue
        });
      });

      if (p.baId) {
        state.expenses.filter(ex => ex.businessAccountId === p.baId).forEach(ex => {
          entries.push({
            date: ex.date,
            type: 'Vendor Payment',
            ref: ex.id,
            narration: ex.remarks || 'Payment paid to vendor',
            debit: 0,
            credit: ex.amount
          });
        });
      }

      state.chequeAllocations.filter(a => a.dispositionType === 'VENDOR_PAYMENT' && a.targetId === vendId).forEach(a => {
        const src = state.receipts.find(rc => rc.id === a.receiptId);
        entries.push({
          date: a.allocationDate,
          type: 'Cheque Endorsed',
          ref: src?.chequeNo || a.id,
          narration: `Cheque #${src?.chequeNo || ''} endorsed to vendor`,
          debit: 0,
          credit: a.amount
        });
        if (a.status === 'REVERSED' && src?.bouncedDate) {
          entries.push({
            date: src.bouncedDate,
            type: 'Endorsement Reversed',
            ref: src.chequeNo || a.id,
            narration: `Endorsed cheque bounced — reverses payment`,
            debit: a.amount,
            credit: 0
          });
        }
      });
    } else if (p.type === 'employee') {
      // Employee / Worker Ledger
      const empId = p.id;
      if (state.wageRuns) {
        state.wageRuns.filter(wr => wr.employeeId === empId && wr.status === 'Posted').forEach(wr => {
          entries.push({
            date: wr.date,
            type: 'Wage Run Accrual',
            ref: wr.id,
            narration: `Piece-rate wage for stage ${wr.stage}`,
            debit: wr.totalAmount,
            credit: 0
          });
        });
      }

      if (state.salaryRuns) {
        state.salaryRuns.filter(sr => sr.status === 'Posted').forEach(sr => {
          const item = sr.items.find(it => it.employeeId === empId);
          if (item) {
            entries.push({
              date: sr.date,
              type: 'Salary Run Accrual',
              ref: sr.id,
              narration: `Monthly Salary for ${sr.periodMonth}`,
              debit: item.amount,
              credit: 0
            });
          }
        });
      }

      if (p.baId) {
        state.expenses.filter(ex => ex.businessAccountId === p.baId).forEach(ex => {
          entries.push({
            date: ex.date,
            type: 'Employee Payment',
            ref: ex.id,
            narration: ex.remarks || 'Wage/Salary Payment Paid',
            debit: 0,
            credit: ex.amount
          });
        });
      }
    } else if (p.type === 'account' && p.baId) {
      // Business Account Ledger
      const baId = p.baId;
      state.expenses.filter(ex => ex.businessAccountId === baId).forEach(ex => {
        entries.push({
          date: ex.date,
          type: 'Expense Entry',
          ref: ex.id,
          narration: ex.remarks || 'Expense Payment Out',
          debit: ex.amount,
          credit: 0
        });
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }, [selectedPerson, state]);

  // Compute Running Ledger & Date Filtered Rows
  const { openingBalance, filteredRows, totalDebit, totalCredit, endingBalance } = useMemo(() => {
    let openBal = 0;
    let before = personLedgerEntries;
    let filtered = personLedgerEntries;

    if (fromDate) {
      before = personLedgerEntries.filter(e => e.date < fromDate);
      filtered = personLedgerEntries.filter(e => e.date >= fromDate);
      openBal = before.reduce((acc, e) => acc + (e.debit - e.credit), 0);
    }

    if (toDate) {
      filtered = filtered.filter(e => e.date <= toDate);
    }

    let running = openBal;
    let sumDebit = 0;
    let sumCredit = 0;

    const rowsWithBalance = filtered.map(e => {
      running += (e.debit - e.credit);
      sumDebit += e.debit;
      sumCredit += e.credit;
      return {
        ...e,
        balance: running
      };
    });

    return {
      openingBalance: openBal,
      filteredRows: rowsWithBalance,
      totalDebit: sumDebit,
      totalCredit: sumCredit,
      endingBalance: running
    };
  }, [personLedgerEntries, fromDate, toDate]);

  // Handle Export Excel & PDF
  const handleExportExcel = () => {
    if (!selectedPerson) return;
    const headers = ['Date', 'Type', 'Reference', 'Narration', 'Debit (PKR)', 'Credit (PKR)', 'Balance (PKR)'];
    const rows = [
      [fromDate ? `Before ${fromDate}` : '---', 'Opening Balance', '-', 'Opening Balance brought forward', '0', '0', openingBalance],
      ...filteredRows.map(r => [r.date, r.type, r.ref, r.narration, r.debit, r.credit, r.balance]),
      ['Total', '', '', '', totalDebit, totalCredit, endingBalance]
    ];
    exportRowsToExcel(`ledger-${selectedPerson.name.toLowerCase().replace(/\s+/g, '-')}`, headers, rows);
  };

  const getTypeBadgeStyle = (type: EntityType) => {
    switch (type) {
      case 'customer':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'vendor':
        return 'bg-slate-900 text-[#B08D57] border-slate-700';
      case 'employee':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'subcustomer':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'account':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getTypeIcon = (type: EntityType) => {
    switch (type) {
      case 'customer': return <User size={16} />;
      case 'vendor': return <Truck size={16} />;
      case 'employee': return <HardHat size={16} />;
      case 'subcustomer': return <Users size={16} />;
      case 'account': return <Landmark size={16} />;
      default: return <BookOpen size={16} />;
    }
  };

  return (
    <AppLayout pageTitle="Overall Searching & Person Ledger">
      <div className="mx-auto" style={{ maxWidth: 1150 }}>
        
        {/* VIEW 1: Directory & Person Search */}
        {!selectedPerson ? (
          <div>
            {/* Header Description */}
            <div className="mb-6">
              <h2 className="font-lora font-bold text-xl text-slate-800">Overall Person & Account Search</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Search any customer, vendor, employee worker, sub-customer, or business account by name or code to view their ledger.
              </p>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-3 rounded-lg border mb-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
                <div className="relative min-w-[240px] max-w-sm flex-1">
                  <Search className="absolute left-3 top-2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by name, code, city, or phone..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input pl-9 py-1.5 w-full text-xs font-semibold"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(['all', 'customer', 'vendor', 'employee', 'subcustomer', 'account'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setEntityFilter(tab)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                        entityFilter === tab
                          ? 'bg-[#111c2a] text-[#B08D57] shadow-sm'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {tab === 'all' ? 'All Entities' : tab === 'customer' ? 'Customers' : tab === 'vendor' ? 'Vendors' : tab === 'employee' ? 'Employees' : tab === 'subcustomer' ? 'Sub-Customers' : 'Accounts'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Entity Directory Cards Grid */}
            {filteredPeople.length === 0 ? (
              <div className="card-white p-12 text-center text-slate-400">
                <Users size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold text-slate-600">No person or account matches your search query.</p>
                <p className="text-xs text-slate-400 mt-1">Try typing a different name or clearing your filter criteria.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPeople.map(person => {
                  const initialLetter = person.name.trim().charAt(0).toUpperCase();

                  return (
                    <div
                      key={`${person.type}-${person.id}`}
                      onClick={() => setSelectedPerson(person)}
                      className="bg-white border rounded-xl p-4 hover:border-amber-500 hover:-translate-y-1 hover:shadow-md transition-all duration-200 flex flex-col justify-between group cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <div>
                        {/* Top: Code badge & Type badge */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border uppercase tracking-wider">
                            ID: {person.id}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider flex items-center gap-1 ${getTypeBadgeStyle(person.type)}`}>
                            {getTypeIcon(person.type)}
                            {person.typeLabel}
                          </span>
                        </div>

                        {/* Middle: Avatar + Name */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm bg-slate-100 text-slate-700 group-hover:bg-[#111c2a] group-hover:text-[#B08D57] transition-colors duration-200 flex-shrink-0">
                            {initialLetter}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 group-hover:text-amber-800 transition-colors leading-tight text-sm truncate">
                              {person.name}
                            </h4>
                            <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                              {person.subtitle}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Action */}
                      <div className="border-t pt-2.5 mt-2 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400 font-semibold uppercase">Financial Ledger</span>
                        <span className="text-xs font-bold text-[#B08D57] group-hover:underline flex items-center gap-1">
                          View Ledger &rarr;
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* VIEW 2: Selected Person Detailed Financial Ledger */
          <div>
            {/* Top Navigation Back Arrow & Title Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6" data-no-print>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedPerson(null)}
                  className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition-all flex items-center gap-1 text-xs font-semibold shadow-sm"
                >
                  <ArrowLeft size={16} /> Back to Search
                </button>
                <div>
                  <h2 className="font-lora font-bold text-xl text-slate-900 flex items-center gap-2">
                    {selectedPerson.name}
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded border uppercase tracking-wider ${getTypeBadgeStyle(selectedPerson.type)}`}>
                      {selectedPerson.typeLabel}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{selectedPerson.subtitle}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <Printer size={14} /> Print Ledger
                </button>
                <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileDown size={14} /> Export PDF
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileSpreadsheet size={14} /> Export Excel
                </button>
              </div>
            </div>

            {/* Date Filters Card */}
            <div className="p-3 rounded-lg border mb-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }} data-no-print>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Net Balance Status Pill */}
              <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg flex items-center gap-2 text-xs font-semibold">
                <span className="text-slate-400">Net Ending Balance:</span>
                <span className="text-[#B08D57] font-bold">{formatCurrency(endingBalance)}</span>
              </div>
            </div>

            {/* Printable Ledger Container */}
            <div className="card-white p-6 md:p-8 bg-white border">
              {/* Printable Header */}
              <div className="border-b pb-4 mb-6 flex justify-between items-start">
                <div>
                  <h3 className="font-lora font-bold text-xl text-slate-900">{selectedPerson.name} — Financial Ledger Statement</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Period: {fromDate || 'Beginning'} to {toDate || 'Present'} • Account Type: {selectedPerson.typeLabel}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                  <p>Generated: {new Date().toLocaleDateString()}</p>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b text-slate-700 font-bold uppercase tracking-wider" style={{ borderColor: 'var(--border-color)' }}>
                      <th className="p-3">Date</th>
                      <th className="p-3">Transaction Type</th>
                      <th className="p-3">Reference / Bill #</th>
                      <th className="p-3">Description / Narration</th>
                      <th className="p-3 text-right">Debit (PKR)</th>
                      <th className="p-3 text-right">Credit (PKR)</th>
                      <th className="p-3 text-right">Balance (PKR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening Balance Row */}
                    <tr className="border-b bg-amber-50/40 font-semibold text-slate-700" style={{ borderColor: 'var(--border-table)' }}>
                      <td className="p-3 text-slate-500">{fromDate ? `Before ${fromDate}` : '---'}</td>
                      <td className="p-3 font-bold text-amber-800">Opening Balance</td>
                      <td className="p-3">-</td>
                      <td className="p-3 italic text-slate-500">Opening Balance brought forward</td>
                      <td className="p-3 text-right">0</td>
                      <td className="p-3 text-right">0</td>
                      <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(openingBalance)}</td>
                    </tr>

                    {/* Transaction Rows */}
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center p-6 text-slate-400 italic">
                          No transactions recorded for {selectedPerson.name} in this date range.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b hover:bg-slate-50/60 transition-colors"
                          style={{ borderColor: 'var(--border-table)' }}
                        >
                          <td className="p-3 font-medium text-slate-600">{row.date}</td>
                          <td className="p-3 font-semibold text-slate-800">{row.type}</td>
                          <td className="p-3 text-slate-500 font-mono">{row.ref}</td>
                          <td className="p-3 text-slate-700">{row.narration}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">
                            {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                          </td>
                          <td className="p-3 text-right font-semibold text-slate-900">
                            {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                          </td>
                          <td className="p-3 text-right font-bold text-amber-900">
                            {formatCurrency(row.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {/* Footer Totals */}
                  <tfoot>
                    <tr className="bg-slate-900 text-white font-bold text-xs">
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-[#B08D57]">
                        Totals for Selected Period
                      </td>
                      <td className="p-3 text-right">{formatCurrency(totalDebit)}</td>
                      <td className="p-3 text-right">{formatCurrency(totalCredit)}</td>
                      <td className="p-3 text-right text-[#B08D57]">{formatCurrency(endingBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </AppLayout>
  );
}
