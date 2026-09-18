import wentoxLogo from '@/assets/wentox_logo.png';
import { formatDate, formatCartons } from '@/lib/utils';

export interface SaleBillPrintItem {
  uid: string;
  label: string;
  packing: number;
  cartons: number;
  pairs: number;
  rate: number;
  discountPercent: number;
  discountValue: number;
  value: number;
}

export interface SaleBillPrintModel {
  statusLabel: string;
  systemNo: number | string;
  date: string;
  storeName: string;
  billNo: string;
  customerName: string;
  subCustomerName: string;
  isCustomDelivery: boolean;
  customAddress: string;
  addaName: string;
  gpNo: string;
  biltyNo: string;
  remarks: string;
  items: SaleBillPrintItem[];
  totalCartons: number;
  totalPairs: number;
  itemsTotalValue: number;
  invoiceDiscount: number;
  finalTotalValue: number;
}

// The Sale Bill's printable invoice — the single template every entry point renders (BA-01,
// changes-14-09-26.md, 2026-09-15: "reuse the existing sale bill print path... a divergent
// template is how two versions of the same invoice end up in circulation"). SaleBillPage builds
// this model from its own live form state (which may be an unsaved bill); BiltyUpdatePage builds
// it from a freshly-fetched, already-posted SaleBillRow. Either way, this component is the only
// place the invoice markup lives — extracted from SaleBillPage's own former `renderBillPrintable`.
export function SaleBillPrintable({ model }: { model: SaleBillPrintModel }) {
  return (
    <div className="excel-print-container" style={{
      display: 'block',
      margin: '0 auto',
      width: '210mm',
      padding: '10mm',
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily: 'Calibri, Arial, sans-serif',
      boxSizing: 'border-box'
    }}>
      {/* Header Section */}
      <div className="excel-print-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #000000',
        marginBottom: '15px',
        paddingBottom: '10px'
      }}>
        <div>
          <img
            src={wentoxLogo}
            alt="Wentox Logo"
            style={{ height: '90px', width: 'auto', objectFit: 'contain' }}
          />
        </div>
        <div style={{ textAlign: 'right' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>SALE INVOICE</h2>
          <p style={{ margin: 0, fontSize: '11px', color: '#555555' }}>Status: {model.statusLabel}</p>
        </div>
      </div>

      {/* Excel Grid Info */}
      <div className="excel-grid-info" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        border: '1px solid #000000',
        marginBottom: '15px'
      }}>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>System ID</label>
          <span>{model.systemNo ?? 'Unsaved'}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Date</label>
          <span>{formatDate(model.date)}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>From Store</label>
          <span>{model.storeName}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Manual Bill No.</label>
          <span>{model.billNo}</span>
        </div>

        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Customer Name</label>
          <span>{model.customerName}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Delivery Destination</label>
          <span>{model.subCustomerName}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Custom Address</label>
          <span>{model.isCustomDelivery ? (model.customAddress || 'N/A') : 'N/A'}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Transport Adda</label>
          <span>{model.addaName}</span>
        </div>

        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Gate Pass (GP) No.</label>
          <span>{model.gpNo || 'N/A'}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Bilty No.</label>
          <span>{model.biltyNo || 'N/A'}</span>
        </div>
        <div style={{ border: '1px solid #000000', padding: '5px 8px', fontSize: '11px', gridColumn: 'span 2' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '2px', textTransform: 'uppercase', fontSize: '9px', color: '#333333' }}>Remarks</label>
          <span>{model.remarks || 'N/A'}</span>
        </div>
      </div>

      {/* Excel Items Table */}
      <table className="excel-print-table" style={{
        width: '100%',
        borderCollapse: 'collapse',
        marginBottom: '15px'
      }}>
        <thead>
          <tr style={{ backgroundColor: '#f2f2f2' }}>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '5%' }}>S#</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'left', width: '40%' }}>Article / Product Description</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '8%' }}>Packing</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Cartons</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Pairs</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '12%' }}>Rate</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', width: '10%' }}>Discount</th>
            <th style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', fontWeight: 'bold', textAlign: 'right', width: '15%' }}>Net Value</th>
          </tr>
        </thead>
        <tbody>
          {model.items.map((item, idx) => {
            const discountText = item.discountPercent > 0
              ? `${item.discountPercent}%`
              : item.discountValue > 0
                ? `${item.discountValue.toLocaleString()}`
                : '-';

            return (
              <tr key={item.uid}>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px' }}>{item.label || 'N/A'}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.packing}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{formatCartons(item.cartons)}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{item.pairs}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.rate.toLocaleString()}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{discountText}</td>
                <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{item.value.toLocaleString()}</td>
              </tr>
            );
          })}

          {/* Total Row */}
          <tr style={{ fontWeight: 'bold', backgroundColor: '#fafafa' }}>
            <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Total Sum:</td>
            <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>-</td>
            <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{formatCartons(model.totalCartons)}</td>
            <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'center' }}>{model.totalPairs}</td>
            <td colSpan={2} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Gross Value:</td>
            <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>{model.itemsTotalValue.toLocaleString()}</td>
          </tr>

          {model.invoiceDiscount > 0 && (
            <tr style={{ fontWeight: 'bold' }}>
              <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right' }}>Invoice Discount:</td>
              <td style={{ border: '1px solid #000000', padding: '6px 8px', fontSize: '11px', textAlign: 'right', color: 'red' }}>-{model.invoiceDiscount.toLocaleString()}</td>
            </tr>
          )}

          <tr className="excel-print-total-row excel-print-double-bottom" style={{
            fontWeight: 'bold',
            backgroundColor: '#f2f2f2',
            fontSize: '12px'
          }}>
            <td colSpan={7} style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', textTransform: 'uppercase' }}>Net Payable Amount (PKR):</td>
            <td style={{ border: '1px solid #000000', padding: '6px 8px', textAlign: 'right', borderBottom: '3px double #000000' }}>{model.finalTotalValue.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      {/* Signatures & Print Info footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '45px', fontSize: '11px' }}>
        <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
          Prepared By
        </div>
        <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
          Checked By
        </div>
        <div style={{ borderTop: '1px solid #000000', width: '180px', textAlign: 'center', paddingTop: '5px' }}>
          Authorized Signature
        </div>
      </div>

      <div className="report-signoff" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '8px', borderTop: '1px solid #000000', fontSize: '9px', fontFamily: 'monospace', color: '#333333' }}>
        <div>WENTOX FOOTWEAR DISTRIBUTION</div>
        <div>Printed: {formatDate(new Date())} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
    </div>
  );
}
