import React from 'react';

interface ReportFooterProps {
  printedBy?: string;
  notes?: string;
  showSignatures?: boolean;
  className?: string;
}

export const ReportFooter: React.FC<ReportFooterProps> = ({
  printedBy = 'System User',
  notes,
  showSignatures = true,
  className = '',
}) => {
  const printTimeStr = `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  return (
    <div className={`report-footer-container mt-6 pt-4 border-t border-slate-200 ${className}`}>
      {notes && (
        <div className="text-xs text-slate-500 mb-4 italic">
          Note: {notes}
        </div>
      )}

      {showSignatures && (
        <div className="grid grid-cols-3 gap-8 pt-8 mb-4 text-center">
          <div>
            <div className="border-b border-slate-400 w-3/4 mx-auto mb-1"></div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Prepared By</span>
          </div>
          <div>
            <div className="border-b border-slate-400 w-3/4 mx-auto mb-1"></div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Checked By</span>
          </div>
          <div>
            <div className="border-b border-slate-400 w-3/4 mx-auto mb-1"></div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Authorized Signature</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono pt-2 border-t border-slate-100">
        <div>WENTOX SOLE ERP System Report</div>
        <div>Printed: {printTimeStr}</div>
        <div>User: {printedBy}</div>
      </div>
    </div>
  );
};
