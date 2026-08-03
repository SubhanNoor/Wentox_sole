import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useApp, formatCurrency } from '@/context/AppContext';
import { Search, Printer, FileDown, FileSpreadsheet, ArrowLeft, ChevronRight, Filter, ChevronDown } from 'lucide-react';
import { exportToPDF, exportRowsToExcel } from '@/lib/export';
import { getTodayDate, getThreeMonthsAgoDate } from '@/lib/utils';

type AccountGroupType = 'all' | 'customer' | 'subcustomer' | 'vendor' | 'employee' | 'chart_account' | 'business_account';

interface AccountBalanceRow {
  code: string;
  description: string;
  type: AccountGroupType;
  typeLabel: string;
  debit: number;
  credit: number;
  netBalance: number; // positive = debit (Naam), negative = credit (Jamma)
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

export default function OverallTrailContent() {
  const { state } = useApp();

  const [asOfDate, setAsOfDate] = useState(getTodayDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<AccountGroupType>('all');
  
  // Custom Searchable Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Selected account for drill-down detailed ledger
  const [selectedAccount, setSelectedAccount] = useState<AccountBalanceRow | null>(null);

  // Date range for drill-down ledger view
  const [ledgerFromDate, setLedgerFromDate] = useState(getThreeMonthsAgoDate());
  const [ledgerToDate, setLedgerToDate] = useState(getTodayDate());

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Calculate Trail Balances for All Accounts ─────────────────────────────
  const trailBalances = useMemo<AccountBalanceRow[]>(() => {
    const list: AccountBalanceRow[] = [];

    // 1. Customers
    state.customers.forEach(c => {
      let debit = 0;
      let credit = 0;

      // Sale Bills (+)
      state.saleBills
        .filter(b => b.customerId === c.id && (!asOfDate || b.date <= asOfDate))
        .forEach(b => { debit += (b.totalValue || 0); });

      // Sale Returns (-)
      state.saleReturns
        .filter(r => r.customerId === c.id && (!asOfDate || r.date <= asOfDate))
        .forEach(r => {
          const val = r.items.reduce((s, i) => s + (i.value || 0), 0) - (r.invoiceDiscount || 0);
          credit += val;
        });

      // Receipts (-)
      state.receipts
        .filter(rc => rc.customerId === c.id && (!asOfDate || rc.date <= asOfDate))
        .forEach(rc => {
          credit += (rc.amount || 0);
          if (rc.commission) credit += rc.commission;
          if (rc.chequeStatus === 'BOUNCED' && rc.bouncedDate && (!asOfDate || rc.bouncedDate <= asOfDate)) {
            debit += (rc.amount + (rc.commission || 0));
          }
          if (rc.chequeStatus === 'RETURNED' && rc.returnedDate && (!asOfDate || rc.returnedDate <= asOfDate)) {
            debit += (rc.amount + (rc.commission || 0));
          }
        });

      const net = debit - credit;
      list.push({
        code: c.id,
        description: c.name,
        type: 'customer',
        typeLabel: 'Customer',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: c
      });
    });

    // 2. Sub-Customers
    state.subCustomers.forEach(s => {
      let debit = 0;
      let credit = 0;

      state.saleBills
        .filter(b => b.subCustomerId === s.id && (!asOfDate || b.date <= asOfDate))
        .forEach(b => {
          debit += (b.totalValue || 0);
        });

      state.saleReturns
        .filter(r => r.subCustomerId === s.id && (!asOfDate || r.date <= asOfDate))
        .forEach(r => {
          const val = r.items.reduce((acc, it) => acc + (it.value || 0), 0) - (r.invoiceDiscount || 0);
          credit += val;
        });

      const net = debit - credit;
      list.push({
        code: s.id,
        description: s.name,
        type: 'subcustomer',
        typeLabel: 'Sub-Customer',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: s
      });
    });

    // 3. Vendors
    state.vendors.forEach(v => {
      let debit = 0;
      let credit = 0;

      state.purchases
        .filter(pr => pr.vendorId === v.id && (!asOfDate || pr.date <= asOfDate))
        .forEach(pr => { debit += (pr.totalValue || 0); });

      state.purchaseReturns
        .filter(prr => prr.vendorId === v.id && (!asOfDate || prr.date <= asOfDate))
        .forEach(prr => { credit += (prr.totalValue || 0); });

      if (v.baId) {
        state.expenses
          .filter(ex => ex.businessAccountId === v.baId && (!asOfDate || ex.date <= asOfDate))
          .forEach(ex => { credit += (ex.amount || 0); });
      }

      state.chequeAllocations
        .filter(a => a.dispositionType === 'VENDOR_PAYMENT' && a.targetId === v.id && (!asOfDate || a.allocationDate <= asOfDate))
        .forEach(a => {
          credit += (a.amount || 0);
          const src = state.receipts.find(rc => rc.id === a.receiptId);
          if (a.status === 'REVERSED' && src?.bouncedDate && (!asOfDate || src.bouncedDate <= asOfDate)) {
            debit += a.amount;
          }
        });

      const net = debit - credit;
      list.push({
        code: v.id,
        description: v.name,
        type: 'vendor',
        typeLabel: 'Vendor Partner',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: v
      });
    });

    // 4. Employees / Workers
    state.employees.forEach(e => {
      let debit = 0;
      let credit = 0;

      if (state.wageRuns) {
        state.wageRuns
          .filter(wr => wr.employeeId === e.id && wr.status === 'Posted' && (!asOfDate || wr.date <= asOfDate))
          .forEach(wr => { debit += (wr.totalAmount || 0); });
      }

      if (state.salaryRuns) {
        state.salaryRuns
          .filter(sr => sr.status === 'Posted' && (!asOfDate || sr.date <= asOfDate))
          .forEach(sr => {
            const item = sr.items.find(it => it.employeeId === e.id);
            if (item) debit += (item.amount || 0);
          });
      }

      if (e.baId) {
        state.expenses
          .filter(ex => ex.businessAccountId === e.baId && (!asOfDate || ex.date <= asOfDate))
          .forEach(ex => { credit += (ex.amount || 0); });
      }

      const net = debit - credit;
      list.push({
        code: e.id,
        description: e.name,
        type: 'employee',
        typeLabel: e.employeeType === 'WORKER' ? 'Worker' : 'Salaried Employee',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: e
      });
    });

    // 5. Chart of Accounts (e.g. Director Expenses, Utilities, Rent, Cash, Banks)
    state.chartAccounts.forEach(ca => {
      let debit = 0;
      let credit = 0;

      const childBAs = state.businessAccounts.filter(ba => ba.controlId === ca.id);
      childBAs.forEach(ba => {
        debit += (ba.openingBalance || 0);
        state.expenses
          .filter(ex => ex.businessAccountId === ba.id && (!asOfDate || ex.date <= asOfDate))
          .forEach(ex => { debit += (ex.amount || 0); });
      });

      const net = debit - credit;
      list.push({
        code: ca.id,
        description: ca.name,
        type: 'chart_account',
        typeLabel: 'Chart of Account',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: ca
      });
    });

    // 6. Business Accounts
    state.businessAccounts.forEach(ba => {
      let debit = ba.openingBalance || 0;
      let credit = 0;

      state.expenses
        .filter(ex => ex.businessAccountId === ba.id && (!asOfDate || ex.date <= asOfDate))
        .forEach(ex => { debit += (ex.amount || 0); });

      const net = debit - credit;
      list.push({
        code: ba.id,
        description: ba.name,
        type: 'business_account',
        typeLabel: 'Business Account',
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        rawObj: ba
      });
    });

    return list;
  }, [state, asOfDate]);

  // Accounts filtered strictly by the active category tab
  const dropdownAccounts = useMemo(() => {
    return trailBalances.filter(r => {
      if (selectedGroup !== 'all' && r.type !== selectedGroup) return false;
      if (!dropdownSearch.trim()) return true;
      const q = dropdownSearch.toLowerCase();
      return (
        r.description.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.typeLabel.toLowerCase().includes(q)
      );
    });
  }, [trailBalances, selectedGroup, dropdownSearch]);

  // Main table filtered rows
  const filteredBalances = useMemo(() => {
    return trailBalances.filter(r => {
      if (selectedGroup !== 'all' && r.type !== selectedGroup) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.description.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.typeLabel.toLowerCase().includes(q)
      );
    });
  }, [trailBalances, selectedGroup, searchQuery]);

  // Grouped rows for section subtotals
  const groupedBalances = useMemo(() => {
    const map = new Map<string, AccountBalanceRow[]>();
    filteredBalances.forEach(row => {
      const label = row.typeLabel;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(row);
    });
    return Array.from(map.entries());
  }, [filteredBalances]);

  // Grand Totals
  const totals = useMemo(() => {
    return filteredBalances.reduce((acc, r) => ({
      totalDebit: acc.totalDebit + r.debit,
      totalCredit: acc.totalCredit + r.credit,
      netTotal: acc.netTotal + r.netBalance
    }), { totalDebit: 0, totalCredit: 0, netTotal: 0 });
  }, [filteredBalances]);

  // ── Drill-down Detailed Ledger Entries Generator ───────────────────────────
  const selectedAccountLedger = useMemo<GenericLedgerRow[]>(() => {
    if (!selectedAccount) return [];

    const entries: GenericLedgerRow[] = [];
    const acc = selectedAccount;

    if (acc.type === 'customer') {
      const cId = acc.code;
      state.saleBills.filter(b => b.customerId === cId).forEach(b => {
        const pairs = b.items.reduce((s, i) => s + (i.pairs || 0), 0);
        entries.push({
          date: b.date,
          type: 'Sale Bill',
          ref: b.billNo || b.id,
          narration: `Sale Bill (${pairs} pairs)`,
          debit: b.totalValue,
          credit: 0
        });
      });

      state.saleReturns.filter(r => r.customerId === cId).forEach(r => {
        const pairs = r.items.reduce((s, i) => s + (i.pairs || 0), 0);
        const val = r.items.reduce((s, i) => s + (i.value || 0), 0) - (r.invoiceDiscount || 0);
        entries.push({
          date: r.date,
          type: 'Sale Return',
          ref: r.billNo || r.id,
          narration: `Sale Return (${pairs} pairs)`,
          debit: 0,
          credit: val
        });
      });

      state.receipts.filter(rc => rc.customerId === cId).forEach(rc => {
        entries.push({
          date: rc.date,
          type: 'Receipt (Jamma)',
          ref: rc.id,
          narration: rc.paymentMode === 'Cheque' ? `Cheque #${rc.chequeNo || ''}` : `Cash Receipt`,
          debit: 0,
          credit: rc.amount
        });
        if (rc.commission) {
          entries.push({
            date: rc.date,
            type: 'Commission',
            ref: rc.id,
            narration: 'Invoice Discount / Commission',
            debit: 0,
            credit: rc.commission
          });
        }
      });
    } else if (acc.type === 'vendor') {
      const vId = acc.code;
      state.purchases.filter(pr => pr.vendorId === vId).forEach(pr => {
        entries.push({
          date: pr.date,
          type: 'Purchase',
          ref: pr.id,
          narration: `Material Purchase`,
          debit: pr.totalValue,
          credit: 0
        });
      });

      state.purchaseReturns.filter(prr => prr.vendorId === vId).forEach(prr => {
        entries.push({
          date: prr.date,
          type: 'Purchase Return',
          ref: prr.id,
          narration: `Purchase Return`,
          debit: 0,
          credit: prr.totalValue
        });
      });

      if (acc.rawObj?.baId) {
        state.expenses.filter(ex => ex.businessAccountId === acc.rawObj.baId).forEach(ex => {
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
    } else if (acc.type === 'employee') {
      const empId = acc.code;
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
      if (acc.rawObj?.baId) {
        state.expenses.filter(ex => ex.businessAccountId === acc.rawObj.baId).forEach(ex => {
          entries.push({
            date: ex.date,
            type: 'Employee Payment',
            ref: ex.id,
            narration: ex.remarks || 'Payment Paid',
            debit: 0,
            credit: ex.amount
          });
        });
      }
    } else if ((acc.type === 'business_account' || acc.type === 'chart_account') && acc.code) {
      const targetId = acc.code;
      state.expenses.filter(ex => ex.businessAccountId === targetId).forEach(ex => {
        entries.push({
          date: ex.date,
          type: 'Expense Entry',
          ref: ex.id,
          narration: ex.remarks || 'Expense Out',
          debit: ex.amount,
          credit: 0
        });
      });
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }, [selectedAccount, state]);

  const { openingBal, filteredLedgerRows, endingBal } = useMemo(() => {
    let openB = 0;
    let before = selectedAccountLedger;
    let filtered = selectedAccountLedger;

    if (ledgerFromDate) {
      before = selectedAccountLedger.filter(e => e.date < ledgerFromDate);
      filtered = selectedAccountLedger.filter(e => e.date >= ledgerFromDate);
      openB = before.reduce((acc, e) => acc + (e.debit - e.credit), 0);
    }

    if (ledgerToDate) {
      filtered = filtered.filter(e => e.date <= ledgerToDate);
    }

    let running = openB;
    const rows = filtered.map(e => {
      running += (e.debit - e.credit);
      return { ...e, balance: running };
    });

    return { openingBal: openB, filteredLedgerRows: rows, endingBal: running };
  }, [selectedAccountLedger, ledgerFromDate, ledgerToDate]);

  // Handle Export Excel & PDF
  const handleExportExcel = () => {
    const headers = ['Account Code', 'Account Description', 'Category', 'Debit (Naam)', 'Credit (Jamma)', 'Net Balance'];
    const rows = [
      ...filteredBalances.map(r => [
        r.code,
        r.description,
        r.typeLabel,
        r.debit > 0 ? r.debit : '-',
        r.credit > 0 ? `(${r.credit})` : '-',
        r.netBalance
      ]),
      ['Total', '', '', totals.totalDebit, `(${totals.totalCredit})`, totals.netTotal]
    ];
    exportRowsToExcel(`overall-trail-balances-${asOfDate}`, headers, rows);
  };

  return (
    <div>
      {/* VIEW 1: Business Accounts Balances Details (Overall Trial Balance) */}
      {!selectedAccount ? (
        <div>
          {/* Top Filter Container with Searchable Dropdown & Action Buttons */}
          <div className="p-4 rounded-xl border mb-4 bg-white shadow-sm flex flex-col gap-3" style={{ borderColor: 'var(--border-color)' }} data-no-print>
            
            {/* ROW 1: Search Input, Custom Searchable Dropdown, As On Date, & Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                
                {/* Search Text Input */}
                <div className="relative min-w-[220px] flex-1 max-w-xs">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <input
                    type="text"
                    placeholder="Search code or description..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="soleria-input pl-9 py-2 w-full text-xs font-semibold"
                  />
                </div>

                {/* Custom Searchable Dropdown Component (Filtered by Active Category Tab) */}
                <div className="relative min-w-[260px] flex-1 max-w-xs" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="soleria-input py-2 px-3 w-full text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 flex items-center justify-between shadow-xs hover:border-slate-400"
                  >
                    <span className="truncate">
                      {selectedGroup === 'all'
                        ? 'Jump to Account (All Accounts)...'
                        : `Jump to Account in ${selectedGroup === 'customer' ? 'Customers' : selectedGroup === 'subcustomer' ? 'Sub-Customers' : selectedGroup === 'vendor' ? 'Vendors' : selectedGroup === 'employee' ? 'Employees' : selectedGroup === 'chart_account' ? 'Chart Accounts' : 'Business Accounts'}...`}
                    </span>
                    <ChevronDown size={14} className="text-slate-500 shrink-0 ml-1" />
                  </button>

                  {/* Dropdown Popup Menu */}
                  {isDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 flex flex-col gap-2 max-h-72">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 text-slate-400" size={14} />
                        <input
                          type="text"
                          placeholder="Type to search sub-accounts..."
                          value={dropdownSearch}
                          onChange={e => setDropdownSearch(e.target.value)}
                          className="w-full text-xs font-semibold pl-8 py-1.5 border border-slate-200 rounded-md outline-none focus:border-amber-500"
                          autoFocus
                        />
                      </div>

                      <div className="overflow-y-auto max-h-56 divide-y divide-slate-100">
                        {dropdownAccounts.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-400 italic">
                            No matching accounts in this category.
                          </div>
                        ) : (
                          dropdownAccounts.map(acc => (
                            <div
                              key={`${acc.type}-${acc.code}`}
                              onClick={() => {
                                setSelectedAccount(acc);
                                setIsDropdownOpen(false);
                                setDropdownSearch('');
                              }}
                              className="p-2 hover:bg-slate-50 rounded-lg cursor-pointer flex items-center justify-between text-xs transition-colors group"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded-full bg-[#111c2a] text-[#B08D57] shrink-0">
                                  {acc.code}
                                </span>
                                <span className="font-bold text-slate-800 group-hover:text-[#B08D57] truncate">
                                  {acc.description}
                                </span>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border uppercase shrink-0">
                                {acc.typeLabel}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* As On Date Selector */}
                <div className="flex items-center gap-1.5 bg-slate-50 py-1.5 px-3 rounded-lg border border-slate-200">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">As On:</label>
                  <input
                    type="date"
                    value={asOfDate}
                    onChange={e => setAsOfDate(e.target.value)}
                    className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <Printer size={14} /> Print Report
                </button>
                <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileDown size={14} /> Export PDF
                </button>
                <button onClick={handleExportExcel} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                  <FileSpreadsheet size={14} /> Export Excel
                </button>
              </div>
            </div>

            {/* ROW 2: Category Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: 'var(--border-color)' }}>
              <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
                <Filter size={13} /> Category:
              </span>
              {(['all', 'customer', 'subcustomer', 'vendor', 'employee', 'chart_account', 'business_account'] as const).map(grp => (
                <button
                  key={grp}
                  onClick={() => {
                    setSelectedGroup(grp);
                    setDropdownSearch('');
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    selectedGroup === grp
                      ? 'bg-[#111c2a] text-[#B08D57] shadow-sm font-bold'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {grp === 'all' ? 'All Accounts' : grp === 'customer' ? 'Customers' : grp === 'subcustomer' ? 'Sub-Customers' : grp === 'vendor' ? 'Vendors' : grp === 'employee' ? 'Employees' : grp === 'chart_account' ? 'Chart Accounts' : 'Business Accounts'}
                </button>
              ))}
            </div>
          </div>

          {/* Main Balances Table (Formatted with Rounded Account Code Pill Badges & Section Subtotals) */}
          <div className="card-white p-5 md:p-6 bg-white border">
            {/* Header metadata */}
            <div className="border-b pb-3 mb-4 flex justify-between items-start">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-900">Business Accounts Balances Details</h3>
                <p className="text-xs text-slate-500 font-medium">As On Date: <span className="font-bold text-slate-700">{asOfDate || 'Today'}</span></p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800 uppercase tracking-wider">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p className="text-[#B08D57] font-semibold">Overall Trail Balances Statement</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  {/* Sidebar Navy & Gold Header */}
                  <tr className="bg-[#111c2a] text-[#B08D57] font-bold uppercase tracking-wider text-[11px] border-b border-[#1a293d]">
                    <th className="p-3 border-r border-[#1a293d]" style={{ width: '160px' }}>Account Code</th>
                    <th className="p-3 border-r border-[#1a293d]">Account Description</th>
                    <th className="p-3 border-r border-[#1a293d]" style={{ width: '130px' }}>Category</th>
                    <th className="p-3 text-center border-r border-[#1a293d]" colSpan={2}>
                      Trail Balances
                    </th>
                    <th className="p-3 text-center" style={{ width: '100px' }}>Action</th>
                  </tr>
                  <tr className="bg-[#1a293d] text-[#B08D57]/90 font-bold uppercase tracking-wider text-[10px] border-b border-slate-700">
                    <th className="p-2 border-r border-[#1a293d]" colSpan={3}></th>
                    <th className="p-2 text-right border-r border-[#1a293d]" style={{ width: '150px' }}>Debit (Naam)</th>
                    <th className="p-2 text-right border-r border-[#1a293d]" style={{ width: '150px' }}>Credit (Jamma)</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400 italic">
                        No account balances found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    groupedBalances.map(([groupName, groupRows]) => {
                      const sectionDebit = groupRows.reduce((s, r) => s + r.debit, 0);
                      const sectionCredit = groupRows.reduce((s, r) => s + r.credit, 0);

                      return (
                        <Fragment key={groupName}>
                          {/* Category Section Header Banner - Sidebar Wentox Navy & Gold (Icon Removed) */}
                          <tr className="bg-[#111c2a] text-[#B08D57] font-bold text-xs border-y border-[#B08D57]/30">
                            <td colSpan={6} className="py-2.5 px-4 font-lora font-bold text-xs text-[#B08D57] uppercase tracking-wider">
                              CATEGORY SECTION: {groupName.toUpperCase()} ({groupRows.length} ACCOUNTS)
                            </td>
                          </tr>

                          {/* Account Rows */}
                          {groupRows.map((row, idx) => (
                            <tr
                              key={`${row.type}-${row.code}-${idx}`}
                              onClick={() => setSelectedAccount(row)}
                              className="hover:bg-slate-50/80 transition-colors cursor-pointer group even:bg-slate-50/30"
                            >
                              {/* Account Code Pill Badge */}
                              <td className="p-2.5 pl-3 border-r border-slate-100">
                                <span className="inline-block px-3 py-1 text-xs font-mono font-bold rounded-full bg-[#111c2a] text-[#B08D57] border border-[#B08D57]/30 shadow-xs">
                                  {row.code}
                                </span>
                              </td>
                              <td className="p-2.5 font-bold text-slate-900 group-hover:text-[#B08D57] transition-colors border-r border-slate-100">
                                <div className="flex items-center justify-between">
                                  <span>{row.description}</span>
                                  <ChevronRight size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </td>
                              <td className="p-2.5 border-r border-slate-100">
                                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border uppercase tracking-wider">
                                  {row.typeLabel}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-100 font-mono">
                                {row.debit > 0 ? (
                                  <span className="text-emerald-700 font-semibold">{formatCurrency(row.debit)}</span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-100 font-mono">
                                {row.credit > 0 ? (
                                  <span className="text-rose-700 font-semibold">({formatCurrency(row.credit)})</span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedAccount(row);
                                  }}
                                  className="px-3.5 py-1 text-[11px] font-semibold text-[#111c2a] bg-[#B08D57] hover:bg-[#111c2a] hover:text-[#B08D57] border border-[#B08D57] rounded-full transition-all shadow-xs"
                                >
                                  View Ledger
                                </button>
                              </td>
                            </tr>
                          ))}

                          {/* Section Subtotal / Summary Row Banner - Left Aligned Text */}
                          <tr className="bg-[#111c2a] text-[#B08D57] font-bold text-xs border-y-2 border-[#B08D57]">
                            <td colSpan={3} className="p-3 text-left pl-4 font-bold text-[#B08D57] uppercase tracking-wider border-r border-[#1a293d] font-lora">
                              SUBTOTAL SUMMARY FOR {groupName.toUpperCase()} ({groupRows.length} ACCOUNTS):
                            </td>
                            <td className="p-3 text-right font-bold text-emerald-400 border-r border-[#1a293d] font-mono">
                              {sectionDebit > 0 ? formatCurrency(sectionDebit) : '-'}
                            </td>
                            <td className="p-3 text-right font-bold text-rose-300 border-r border-[#1a293d] font-mono">
                              {sectionCredit > 0 ? `(${formatCurrency(sectionCredit)})` : '-'}
                            </td>
                            <td className="p-3"></td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[#111c2a] text-white font-bold text-xs">
                    <td colSpan={3} className="p-3 text-right uppercase tracking-wider text-[#B08D57] border-r border-slate-800 font-bold">
                      Grand Total Trail Balances
                    </td>
                    <td className="p-3 text-right border-r border-slate-800 text-emerald-400 font-bold font-mono">{formatCurrency(totals.totalDebit)}</td>
                    <td className="p-3 text-right border-r border-slate-800 text-rose-300 font-bold font-mono">({formatCurrency(totals.totalCredit)})</td>
                    <td className="p-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* VIEW 2: Drill-down Specific Account Ledger */
        <div>
          {/* Header & Back Button */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedAccount(null)}
                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition-all flex items-center gap-1 text-xs font-semibold shadow-sm"
              >
                <ArrowLeft size={16} /> Back to Overall Trail Balances
              </button>
              <div>
                <h2 className="font-lora font-bold text-xl text-slate-900">
                  {selectedAccount.description} — Detailed Ledger
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Code: {selectedAccount.code} • Category: {selectedAccount.typeLabel}
                </p>
              </div>
            </div>

            {/* Print & Export Controls */}
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                <Printer size={14} /> Print Ledger
              </button>
              <button onClick={() => exportToPDF()} className="btn-outline flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold">
                <FileDown size={14} /> Export PDF
              </button>
            </div>
          </div>

          {/* Date Filter Bar */}
          <div className="p-3 rounded-lg border mb-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">From Date:</label>
                <input
                  type="date"
                  value={ledgerFromDate}
                  onChange={e => setLedgerFromDate(e.target.value)}
                  className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">To Date:</label>
                <input
                  type="date"
                  value={ledgerToDate}
                  onChange={e => setLedgerToDate(e.target.value)}
                  className="soleria-input py-1.5 px-2.5 text-xs font-semibold"
                />
              </div>
            </div>

            <div className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg flex items-center gap-2 text-xs font-semibold">
              <span className="text-slate-400">Net Ending Balance:</span>
              <span className="text-[#B08D57] font-bold">{formatCurrency(endingBal)}</span>
            </div>
          </div>

          {/* Detailed Ledger Table */}
          <div className="card-white p-6 md:p-8 bg-white border">
            <div className="border-b pb-4 mb-6 flex justify-between items-start">
              <div>
                <h3 className="font-lora font-bold text-lg text-slate-900">{selectedAccount.description} Account Statement</h3>
                <p className="text-xs text-slate-500">Period: {ledgerFromDate || 'Start'} to {ledgerToDate || 'End'}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-bold text-slate-800">WENTOX FOOTWEAR DISTRIBUTION</p>
                <p>Account Ledger Statement</p>
              </div>
            </div>

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
                  <tr className="border-b bg-amber-50/40 font-semibold text-slate-700" style={{ borderColor: 'var(--border-table)' }}>
                    <td className="p-3 text-slate-500">{ledgerFromDate ? `Before ${ledgerFromDate}` : '---'}</td>
                    <td className="p-3 font-bold text-amber-800">Opening Balance</td>
                    <td className="p-3">-</td>
                    <td className="p-3 italic text-slate-500">Opening Balance brought forward</td>
                    <td className="p-3 text-right">0</td>
                    <td className="p-3 text-right">0</td>
                    <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(openingBal)}</td>
                  </tr>

                  {filteredLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-6 text-slate-400 italic">
                        No ledger transactions found for this date range.
                      </td>
                    </tr>
                  ) : (
                    filteredLedgerRows.map((row, idx) => (
                      <tr key={idx} className="border-b hover:bg-slate-50/60 transition-colors" style={{ borderColor: 'var(--border-table)' }}>
                        <td className="p-3 font-medium text-slate-600">{row.date}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.type}</td>
                        <td className="p-3 text-slate-500 font-mono">{row.ref}</td>
                        <td className="p-3 text-slate-700">{row.narration}</td>
                        <td className="p-3 text-right font-semibold text-slate-900">{row.debit > 0 ? formatCurrency(row.debit) : '-'}</td>
                        <td className="p-3 text-right font-semibold text-slate-900">{row.credit > 0 ? formatCurrency(row.credit) : '-'}</td>
                        <td className="p-3 text-right font-bold text-amber-900">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
