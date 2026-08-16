import { Fragment, useState, useMemo, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/context/AppContext';
import { todayISO } from '@/lib/cheques';
import { formatDate } from '@/lib/utils';
import { Search, AlertTriangle, Eye } from 'lucide-react';
import { exportRowsToExcel } from '@/lib/export';
import SearchableSelect from '@/components/SearchableSelect';
import * as api from '@/lib/api';
import type { ChequeRow, ChequeAllocationRow, ChequeStatus, ChequeDispositionType, VendorRow, BankAccountRow, BusinessAccountRow } from '@/lib/api';
import wentoxLogo from '@/assets/wentox_logo.png';
import { ReportPrintPreviewModal } from '@/components/reports/ReportPrintPreviewModal';

const STATUS_STYLES: Record<ChequeStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  DEPOSITED: 'bg-blue-50 text-blue-800 border-blue-200',
  ENDORSED: 'bg-violet-50 text-violet-800 border-violet-200',
  PARTIALLY_ENDORSED: 'bg-orange-50 text-orange-800 border-orange-200',
  CLEARED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  BOUNCED: 'bg-rose-50 text-rose-800 border-rose-200',
  RETURNED: 'bg-slate-100 text-slate-700 border-slate-300',
};

const DISPOSITION_LABELS: Record<ChequeDispositionType, string> = {
  DEPOSIT: 'Deposit to bank',
  VENDOR_PAYMENT: 'Pay a vendor',
  EXPENSE_PAYMENT: 'Pay an expense account',
};

export default function ChequesTab() {
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [allocationsByReceipt, setAllocationsByReceipt] = useState<Record<number, ChequeAllocationRow[]>>({});
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | ChequeStatus>('open');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // "Open" = still outstanding, i.e. not yet CLEARED and not BOUNCED/RETURNED. DEPOSITED belongs
  // here: banking a cheque does not settle it — the bank has not confirmed it yet, and Mark Cleared
  // is the next thing someone has to do to it. Leaving DEPOSITED out meant a cheque vanished from
  // the default view the moment it was deposited, and since Mark Cleared only renders on a
  // DEPOSITED row, the button was unreachable until the operator changed the filter by hand.
  const OPEN_STATUSES: ChequeStatus[] = ['PENDING', 'PARTIALLY_ENDORSED', 'DEPOSITED'];

  const statusOptionsList: { value: 'all' | 'open' | ChequeStatus; label: string }[] = [
    { value: 'open', label: 'Open (not yet cleared)' },
    { value: 'all', label: 'All cheques' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'PARTIALLY_ENDORSED', label: 'Partially Endorsed' },
    { value: 'ENDORSED', label: 'Endorsed' },
    { value: 'DEPOSITED', label: 'Deposited' },
    { value: 'CLEARED', label: 'Cleared' },
    { value: 'BOUNCED', label: 'Bounced' },
    { value: 'RETURNED', label: 'Returned to Sender' },
  ];

  const selectedStatusLabel = useMemo(() => {
    return statusOptionsList.find(o => o.value === statusFilter)?.label || 'Open (not yet cleared)';
  }, [statusFilter]);

  // Dispose dialog state
  const [disposingCheque, setDisposingCheque] = useState<ChequeRow | null>(null);
  const [disposition, setDisposition] = useState<ChequeDispositionType>('VENDOR_PAYMENT');
  const [targetId, setTargetId] = useState('');
  const [depositBankId, setDepositBankId] = useState('');
  const [allocAmount, setAllocAmount] = useState<number>(0);
  const [allocDate, setAllocDate] = useState(todayISO());
  const [allocRemarks, setAllocRemarks] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [disposeUnallocated, setDisposeUnallocated] = useState(0);

  // Bounce confirmation state
  const [bouncingCheque, setBouncingCheque] = useState<ChequeRow | null>(null);
  const [bounceDate, setBounceDate] = useState(todayISO());

  // Return-to-sender confirmation state
  const [returningCheque, setReturningCheque] = useState<ChequeRow | null>(null);
  const [returnDate, setReturnDate] = useState(todayISO());

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const flash = (m: string) => { setSuccessMsg(m); setTimeout(() => setSuccessMsg(''), 5000); };
  const fail = (m: string) => { setErrorMsg(m); setTimeout(() => setErrorMsg(''), 5000); };

  const loadCheques = useCallback(async () => {
    setLoading(true);
    const res = await api.cheques.list();
    if (res.ok) {
      setCheques(res.data);
      const entries = await Promise.all(
        res.data.map(async c => {
          const allocRes = await api.cheques.allocationsForReceipt(c.receipt_id);
          return [c.receipt_id, allocRes.ok ? allocRes.data : []] as const;
        })
      );
      setAllocationsByReceipt(Object.fromEntries(entries));
    } else {
      fail('Failed to load cheques: ' + res.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCheques();
    api.listVendors().then(res => { if (res.ok) setVendors(res.data); });
    api.bankAccounts.list().then(res => { if (res.ok) setBanks(res.data); });
    api.listBusinessAccounts().then(res => { if (res.ok) setBusinessAccounts(res.data); });
  }, [loadCheques]);

  function unallocatedFor(c: ChequeRow): number {
    if (c.cheque_status === 'BOUNCED' || c.cheque_status === 'RETURNED') return 0;
    const active = (allocationsByReceipt[c.receipt_id] || []).filter(a => a.status === 'ACTIVE');
    const allocated = active.reduce((s, a) => s + a.amount, 0);
    return Math.max(0, (c.receipt_amount ?? 0) - allocated);
  }

  const chequeRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cheques
      .map(c => ({
        cheque: c,
        customerName: c.account_name || c.customer_name || 'Unknown account',
        status: c.cheque_status,
        unallocated: unallocatedFor(c),
        allocations: allocationsByReceipt[c.receipt_id] || [],
      }))
      .filter(row => {
        if (statusFilter === 'open') {
          if (!OPEN_STATUSES.includes(row.status)) return false;
        } else if (statusFilter !== 'all' && row.status !== statusFilter) {
          return false;
        }
        if (!q) return true;
        return (
          row.cheque.cheque_no.toLowerCase().includes(q) ||
          row.customerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.cheque.cheque_date.localeCompare(b.cheque.cheque_date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheques, allocationsByReceipt, search, statusFilter]);

  const disposingRow = disposingCheque
    ? {
        cheque: disposingCheque,
        customerName: disposingCheque.account_name || disposingCheque.customer_name || 'Unknown account',
        unallocated: disposeUnallocated,
      }
    : undefined;

  function openDispose(cheque: ChequeRow) {
    const remaining = unallocatedFor(cheque);
    setDisposingCheque(cheque);
    setDisposeUnallocated(remaining);
    setDisposition('VENDOR_PAYMENT');
    setTargetId('');
    setDepositBankId('');
    setAllocAmount(remaining);
    setAllocDate(todayISO());
    setAllocRemarks('');
    setDialogError('');
  }

  const saveAllocation = async () => {
    if (!disposingRow) return;
    const remaining = disposingRow.unallocated;

    if (allocAmount <= 0) return setDialogError('Amount must be greater than 0.');
    if (allocAmount > remaining) {
      return setDialogError(
        `Amount cannot exceed the unallocated balance of ${formatCurrency(remaining)}.`
      );
    }
    if ((disposition === 'VENDOR_PAYMENT' || disposition === 'EXPENSE_PAYMENT') && !targetId) {
      return setDialogError('Please choose who this cheque is being paid to.');
    }
    if (disposition === 'DEPOSIT' && !depositBankId) {
      return setDialogError('Please choose which bank account this cheque is deposited into.');
    }
    if (!allocDate) return setDialogError('Please pick an allocation date.');

    const chequeId = disposingRow.cheque.cheque_id;
    const payload = { amount: allocAmount, allocation_date: allocDate, remarks: allocRemarks || undefined };
    const res = disposition === 'DEPOSIT'
      ? await api.cheques.deposit(chequeId, { ...payload, bank_id: Number(depositBankId) })
      : disposition === 'VENDOR_PAYMENT'
      ? await api.cheques.endorseToVendor(chequeId, { ...payload, vendor_id: Number(targetId) })
      : await api.cheques.endorseToExpense(chequeId, { ...payload, target_ba_id: Number(targetId) });

    if (!res.ok) return setDialogError(res.error.message);

    const leftover = remaining - allocAmount;
    flash(
      leftover > 0
        ? `Allocated ${formatCurrency(allocAmount)}. ${formatCurrency(leftover)} of this cheque is still unassigned — assign it before the cheque is fully disposed.`
        : `Allocated ${formatCurrency(allocAmount)}. This cheque is now fully disposed.`
    );

    await loadCheques();

    if (leftover > 0) {
      setDisposeUnallocated(leftover);
      setAllocAmount(leftover);
      setTargetId('');
      setDepositBankId('');
      setAllocRemarks('');
      setDialogError('');
    } else {
      setDisposingCheque(null);
    }
  };

  const confirmBounce = async () => {
    if (!bouncingCheque) return;
    const res = await api.cheques.bounce(bouncingCheque.cheque_id, { bounced_date: bounceDate });
    if (!res.ok) { fail(res.error.message); return; }
    const reversedCount = (allocationsByReceipt[bouncingCheque.receipt_id] || []).filter(a => a.status === 'ACTIVE').length;
    flash(
      reversedCount > 0
        ? `Cheque ${bouncingCheque.cheque_no} marked bounced. The customer's due is restored and ${reversedCount} allocation(s) were reversed.`
        : `Cheque ${bouncingCheque.cheque_no} marked bounced. The customer's due is restored.`
    );
    setBouncingCheque(null);
    await loadCheques();
  };

  const confirmReturn = async () => {
    if (!returningCheque) return;
    const res = await api.cheques.returnToSender(returningCheque.cheque_id, { returned_date: returnDate });
    if (!res.ok) { fail(res.error.message); return; }
    const reversedCount = (allocationsByReceipt[returningCheque.receipt_id] || []).filter(a => a.status === 'ACTIVE').length;
    flash(
      reversedCount > 0
        ? `Cheque ${returningCheque.cheque_no} returned to sender. The customer's due is restored and ${reversedCount} allocation(s) were reversed. They can pay again later via any payment method.`
        : `Cheque ${returningCheque.cheque_no} returned to sender. The customer's due is restored — they can pay again later via any payment method.`
    );
    setReturningCheque(null);
    await loadCheques();
  };

  const markCleared = async (cheque: ChequeRow) => {
    const res = await api.cheques.markCleared(cheque.cheque_id);
    if (!res.ok) { fail(res.error.message); return; }
    flash(`Cheque ${cheque.cheque_no} marked cleared.`);
    await loadCheques();
  };

  const vendorOptions = useMemo(
    () => vendors.map(v => ({ value: String(v.vendor_id), label: v.name })),
    [vendors]
  );
  const businessAccountOptions = useMemo(
    () => businessAccounts.map(b => ({ value: String(b.ba_id), label: b.name })),
    [businessAccounts]
  );
  const bankOptions = useMemo(
    () => banks.map(b => ({ value: String(b.bank_id), label: b.name })),
    [banks]
  );

  function allocTargetName(a: ChequeAllocationRow): string {
    if (a.disposition_type === 'DEPOSIT') return 'Bank deposit';
    return a.vendor_name || a.target_name || 'Vendor';
  }

  const handleExportExcel = () => {
    const headers = ['Received Date', 'Party Name', 'Cheque No', 'Due Date', 'Amount', 'Unallocated', 'Status'];
    const rows = chequeRows.map(r => [
      formatDate(r.cheque.cheque_received_date), r.customerName, r.cheque.cheque_no || '-',
      formatDate(r.cheque.cheque_date), r.cheque.receipt_amount ?? 0, r.unallocated, r.status,
    ]);
    exportRowsToExcel('cheque-register', headers, rows);
  };

  const totalValue = useMemo(() => chequeRows.reduce((sum, r) => sum + (r.cheque.receipt_amount ?? 0), 0), [chequeRows]);
  const totalUnallocated = useMemo(() => chequeRows.reduce((sum, r) => sum + r.unallocated, 0), [chequeRows]);

  const renderPrintableDocument = () => (
    <div className="excel-print-container">
      {/* Header Section with Huge Prominent Logo */}
      <div className="excel-print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000000', marginBottom: '15px', paddingBottom: '12px' }}>
        <div>
          <img src={wentoxLogo} alt="Wentox Logo" style={{ height: '90px', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>CHEQUES RECEIVED DIRECTORY</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: '#111111' }}>
            Filter: {selectedStatusLabel}
          </p>
          <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#555555' }}>
            Date of Print: {formatDate(new Date())}
          </p>
        </div>
      </div>

      {/* Results Table */}
      <table className="excel-print-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px' }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Received Date</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Party Name</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'left' }}>Cheque No.</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Due Date</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'center' }}>Status</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Total (Rs.)</th>
            <th style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', backgroundColor: '#f2f2f2', fontWeight: 'bold', textAlign: 'right' }}>Unassigned (Rs.)</th>
          </tr>
        </thead>
        <tbody>
          {chequeRows.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '10px', fontSize: '11px', textAlign: 'center', color: '#666666' }}>
                No cheques match the selected filter.
              </td>
            </tr>
          ) : (
            chequeRows.map(row => (
              <tr key={row.cheque.cheque_id}>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{formatDate(row.cheque.cheque_received_date)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '11px', fontWeight: 'bold' }}>{row.customerName}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 'bold' }}>{row.cheque.cheque_no || '-'}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'center', fontFamily: 'monospace' }}>{formatDate(row.cheque.cheque_date)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10px', textAlign: 'center', fontWeight: 'bold' }}>{row.status}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatCurrency(row.cheque.receipt_amount ?? 0)}</td>
                <td style={{ border: '1px solid #000000', padding: '5px 6px', fontSize: '10.5px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(row.unallocated)}</td>
              </tr>
            ))
          )}
          <tr className="excel-print-total-row excel-print-double-bottom" style={{ fontWeight: 'bold', backgroundColor: '#f9f9f9' }}>
            <td colSpan={4} style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'left' }}>REPORT TOTAL SUM</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totalValue)}</td>
            <td style={{ border: '1px solid #000000', padding: '6px', fontSize: '11px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCurrency(totalUnallocated)}</td>
            {/* 4 + 1 + 1 + 1 = 7, matching the header. Without this cell the Status column had no
                footer, so the printed totals sat one column left of the figures they belonged to. */}
            <td style={{ border: '1px solid #000000', padding: '6px' }} />
          </tr>
        </tbody>
      </table>

      {/* Signatures & Print Info footer */}
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
        <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
    </div>
  );

  return (
    <div>
      {successMsg && (
        <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{successMsg}</div>
      )}
      {errorMsg && (
        <div className="banner-error rounded-lg px-4 py-3 text-sm mb-4" data-no-print>{errorMsg}</div>
      )}

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border mb-6 bg-white"
        style={{ borderColor: 'var(--border-color)' }}
        data-no-print
      >
        <div className="flex flex-wrap items-center gap-4 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[220px]">
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Search:</span>
            <div className="relative">
              <input
                type="text"
                placeholder="Cheque no. or customer..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="soleria-input w-full py-2 text-sm pr-10 font-semibold"
              />
              <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
            </div>
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase mb-1">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="soleria-input py-1.5 cursor-pointer text-xs min-w-[170px]"
            >
              <option value="open">Open (Pending / Partial)</option>
              <option value="all">All cheques</option>
              <option value="PENDING">Pending</option>
              <option value="PARTIALLY_ENDORSED">Partially Endorsed</option>
              <option value="ENDORSED">Endorsed</option>
              <option value="DEPOSITED">Deposited</option>
              <option value="CLEARED">Cleared</option>
              <option value="BOUNCED">Bounced</option>
              <option value="RETURNED">Returned to Sender</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs"
          >
            <Eye size={15} /> Show Print Preview
          </button>
        </div>
      </div>

      <div className="card-white p-6 md:p-8 bg-white border">
        <div className="flex items-center justify-between border-b pb-4 mb-6">
          <div>
            <h1 className="font-lora font-bold text-2xl" style={{ color: 'var(--brand-navy)' }}>WENTOX</h1>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-inter">Footwear Distribution</p>
          </div>
          <h2 className="font-lora font-semibold text-lg uppercase">Cheques Received</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr
                className="bg-slate-50 border-b text-xs font-semibold uppercase tracking-wider text-slate-500"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <th className="p-3 pl-4 text-center">Received Date</th>
                <th className="p-3">Party Name</th>
                <th className="p-3">Cheque No.</th>
                <th className="p-3 text-center">Due Date</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Unallocated</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center" data-no-print>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chequeRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-8 text-slate-400">
                    {loading ? 'Loading…' : 'No cheques match this filter.'}
                  </td>
                </tr>
              ) : (
                chequeRows.map(row => {
                  // assertDisposable() rejects every disposal action while the underlying receipt is
                  // still DRAFT. Until receipt_status was carried on the row the screen could not
                  // tell, so it offered a Dispose button that always came back "This receipt is not
                  // posted yet" — the operator's actual next step is on the Receipts screen.
                  const receiptPosted = row.cheque.receipt_status !== 'DRAFT';
                  const canDispose = receiptPosted && row.status !== 'BOUNCED' && row.status !== 'CLEARED' && row.unallocated > 0;
                  const canReturn = receiptPosted && (row.status === 'PENDING' || row.status === 'PARTIALLY_ENDORSED');
                  return (
                    <Fragment key={row.cheque.cheque_id}>
                      <tr
                        className="border-b hover:bg-slate-50/50"
                        style={{ borderColor: 'var(--border-table)' }}
                      >
                        <td className="p-3 pl-4 text-center text-xs text-slate-500">{formatDate(row.cheque.cheque_received_date)}</td>
                        <td className="p-3 font-semibold text-slate-800">{row.customerName}</td>
                        <td className="p-3 font-mono font-semibold text-slate-800">
                          {row.cheque.cheque_no || '-'}
                        </td>
                        <td className="p-3 text-center text-xs text-slate-600">{formatDate(row.cheque.cheque_date)}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatCurrency(row.cheque.receipt_amount ?? 0)}</td>
                        <td className="p-3 text-right font-bold" style={{ color: row.unallocated > 0 ? '#b45309' : '#64748b' }}>
                          {row.unallocated > 0 ? formatCurrency(row.unallocated) : '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${STATUS_STYLES[row.status]}`}>
                            {row.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-3" data-no-print>
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {canDispose && (
                              <button
                                onClick={() => openDispose(row.cheque)}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
                              >
                                Issue
                              </button>
                            )}
                            {!receiptPosted && (
                              <span
                                title="Post the receipt on the Receipts (Jamma) screen before disposing of this cheque"
                                className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-amber-50 text-amber-800 border-amber-200"
                              >
                                Receipt not posted
                              </span>
                            )}
                            {receiptPosted && row.status === 'DEPOSITED' && (
                              <button
                                onClick={() => markCleared(row.cheque)}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors"
                              >
                                Mark Cleared
                              </button>
                            )}
                            {receiptPosted && row.status !== 'BOUNCED' && row.status !== 'RETURNED' && (
                              <button
                                onClick={() => { setBouncingCheque(row.cheque); setBounceDate(todayISO()); }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 transition-colors"
                              >
                                Mark Bounced
                              </button>
                            )}
                            {canReturn && (
                              <button
                                onClick={() => { setReturningCheque(row.cheque); setReturnDate(todayISO()); }}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 transition-colors"
                              >
                                Return to Sender
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Allocation history for this cheque */}
                      {row.allocations.length > 0 && (
                        <tr className="border-b" style={{ borderColor: 'var(--border-table)' }}>
                          <td colSpan={8} className="px-4 py-2 bg-slate-50/60">
                            <div className="flex flex-col gap-1">
                              {row.allocations.map(a => (
                                <div key={a.allocation_id} className="flex items-center gap-3 text-[11px]">
                                  <span className="font-semibold uppercase tracking-wider text-slate-400" style={{ minWidth: 90 }}>
                                    {a.disposition_type.replace('_', ' ')}
                                  </span>
                                  <span className="font-semibold text-slate-700">{allocTargetName(a)}</span>
                                  <span className="font-mono font-bold text-slate-800">{formatCurrency(a.amount)}</span>
                                  <span className="text-slate-500">{formatDate(a.allocation_date)}</span>
                                  {a.status === 'REVERSED' && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 uppercase">
                                      Reversed
                                    </span>
                                  )}
                                  {a.remarks && <span className="text-slate-400 italic truncate">{a.remarks}</span>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dispose dialog ── */}
      {disposingRow && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <form onSubmit={e => e.preventDefault()} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-lg mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-1">Issue Cheque</h3>
            <p className="text-xs text-slate-500 mb-4">
              {disposingRow.cheque.cheque_no} &middot; {disposingRow.customerName} &middot; {formatCurrency(disposingRow.cheque.receipt_amount ?? 0)}
            </p>

            <div className="flex items-center justify-between p-3 rounded-lg border mb-4"
                 style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Unallocated balance</span>
              <span className="font-mono font-bold text-amber-900">{formatCurrency(disposingRow.unallocated)}</span>
            </div>

            {dialogError && (
              <div className="banner-error rounded-lg px-3 py-2 text-xs mb-3">{dialogError}</div>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Disposition</label>
                <select
                  value={disposition}
                  onChange={e => { setDisposition(e.target.value as ChequeDispositionType); setTargetId(''); }}
                  className="soleria-input cursor-pointer font-semibold"
                >
                  {(Object.keys(DISPOSITION_LABELS) as ChequeDispositionType[]).map(d => (
                    <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>
                  ))}
                </select>
              </div>

              {disposition === 'VENDOR_PAYMENT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor</label>
                  <SearchableSelect
                    options={vendorOptions}
                    value={targetId}
                    onChange={setTargetId}
                    placeholder="Search & select..."
                    searchPlaceholder="Type to search..."
                  />
                </div>
              )}

              {disposition === 'EXPENSE_PAYMENT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Expense Account</label>
                  <SearchableSelect
                    options={businessAccountOptions}
                    value={targetId}
                    onChange={setTargetId}
                    placeholder="Search & select..."
                    searchPlaceholder="Type to search..."
                  />
                </div>
              )}

              {disposition === 'DEPOSIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Deposit Into <span className="text-red-500 font-bold">*</span>
                  </label>
                  {banks.length === 0 ? (
                    <div className="soleria-input text-rose-600 text-sm flex items-center font-semibold">
                      Add a bank account first
                    </div>
                  ) : (
                    <SearchableSelect
                      options={bankOptions}
                      value={depositBankId}
                      onChange={setDepositBankId}
                      placeholder="Select bank account..."
                      searchPlaceholder="Type to search..."
                    />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Without this the cheque leaves Cheques in Hand and lands nowhere.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
                  <input
                    type="number"
                    min={0}
                    max={disposingRow.unallocated}
                    value={allocAmount || ''}
                    onChange={e => setAllocAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="soleria-input font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Allocation date</label>
                  <input
                    type="date"
                    value={allocDate}
                    onChange={e => setAllocDate(e.target.value)}
                    className="soleria-input"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Cash Book dates the outflow here</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks</label>
                <input
                  type="text"
                  value={allocRemarks}
                  onChange={e => setAllocRemarks(e.target.value)}
                  placeholder="Optional note..."
                  className="soleria-input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDisposingCheque(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="submit"
                onClick={saveAllocation}
                className="px-4 py-2 text-sm rounded-lg bg-[#111c2a] text-[#B08D57] hover:opacity-90"
              >
                Save Allocation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Bounce confirmation ── */}
      {bouncingCheque && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <form onSubmit={e => e.preventDefault()} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-rose-600" /> Mark Cheque Bounced
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              This reverses <strong>both sides</strong>: the customer's payment is cancelled so their
              due goes back up, and every allocation made from this cheque is reversed so the
              vendor's or expense account's balance goes back up too. Original entries are kept —
              the correction is posted on the date below, so reports you have already printed still
              reconcile.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bounce date</label>
              <input
                type="date"
                value={bounceDate}
                onChange={e => setBounceDate(e.target.value)}
                className="soleria-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBouncingCheque(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={confirmBounce}
                className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700"
              >
                Confirm Bounce
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Return-to-sender confirmation ── */}
      {returningCheque && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn" data-no-print>
          <form onSubmit={e => e.preventDefault()} className="bg-white rounded-xl shadow-xl border p-6 w-full max-w-md mx-4 animate-scaleUp">
            <h3 className="font-lora font-bold text-lg text-slate-800 mb-2 flex items-center gap-2">
              <AlertTriangle size={18} className="text-slate-600" /> Return Cheque to Sender
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              For an overdue cheque being handed back to the customer — not a bank rejection. This
              reverses <strong>both sides</strong>, same as a bounce: the customer's payment is
              cancelled so their due goes back up, and every allocation made from this cheque is
              reversed. The customer is expected to pay again later via any payment method — a
              normal new Receipt. Original entries are kept — the correction is posted on the date
              below, so reports you have already printed still reconcile.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Return date</label>
              <input
                type="date"
                value={returnDate}
                onChange={e => setReturnDate(e.target.value)}
                className="soleria-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReturningCheque(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={confirmReturn}
                className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-white hover:bg-slate-800"
              >
                Confirm Return
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Full-Screen Interactive Print Preview Modal */}
      <ReportPrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Cheques Received Directory - Print Preview"
        orientation="portrait"
        onExportExcel={handleExportExcel}
      >
        {renderPrintableDocument()}
      </ReportPrintPreviewModal>
    </div>
  );
}
