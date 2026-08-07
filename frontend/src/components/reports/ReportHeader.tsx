import React from 'react';
import type { CompanyInfo, ReportMetaField } from '@/lib/reportConfig';
import wentoxLogo from '@/assets/wentox_logo.png';

interface ReportHeaderProps {
  title: string;
  subtitle?: string;
  periodFrom?: string;
  periodTo?: string;
  companyInfo?: CompanyInfo;
  metadata?: ReportMetaField[];
  className?: string;
}

export const ReportHeader: React.FC<ReportHeaderProps> = ({
  title,
  subtitle,
  periodFrom,
  periodTo,
  metadata = [],
  className = '',
}) => {
  return (
    <div className={`report-header-container border-b-2 border-slate-900/80 pb-4 mb-4 ${className}`}>
      {/* Primary Header Row */}
      <div className="flex items-center justify-between gap-6">
        {/* Left: Full Company Logo Image */}
        <div className="flex items-center">
          <img
            src={wentoxLogo}
            alt="Wentox Sole Logo"
            className="h-48 md:h-52 w-auto object-contain max-h-60 print:h-44"
          />
        </div>

        {/* Right: Report Title & Period */}
        <div className="text-right">
          <div className="inline-block bg-slate-900 text-white px-3.5 py-1.5 rounded-md print:bg-slate-900 print:text-white">
            <h2 className="text-sm font-bold uppercase tracking-widest font-mono">
              {title}
            </h2>
          </div>
          {subtitle && (
            <p className="text-xs font-medium text-slate-600 mt-1 print:text-[11px]">
              {subtitle}
            </p>
          )}
          {(periodFrom || periodTo) && (
            <div className="mt-1 text-xs font-mono font-medium text-slate-700 print:text-[11px]">
              <span className="text-slate-500">Period: </span>
              {periodFrom || 'Start'} <span className="text-slate-400">to</span> {periodTo || 'Today'}
            </div>
          )}
          <div className="text-[10px] text-slate-400 mt-0.5 font-mono print:text-[9px]">
            Generated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Metadata Fields Grid */}
      {metadata.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-200/80 grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50/60 p-2.5 rounded-lg text-xs print:bg-slate-50 print:p-2">
          {metadata.map((field, idx) => (
            <div key={idx} className="flex flex-col">
              <span className="text-[10px] uppercase font-semibold text-slate-600 tracking-wider">
                {field.label}
              </span>
              <span className="font-semibold text-slate-900 font-mono text-xs">
                {field.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
