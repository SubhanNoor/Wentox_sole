import React from 'react';
import type { ReportOrientation } from '@/lib/reportConfig';

interface ReportContainerProps {
  children: React.ReactNode;
  orientation?: ReportOrientation;
  className?: string;
}

export const ReportContainer: React.FC<ReportContainerProps> = ({
  children,
  orientation = 'portrait',
  className = '',
}) => {
  const orientationClass = orientation === 'landscape' ? 'landscape-report' : 'portrait-report';

  return (
    <div
      className={`report-printable-area bg-white text-slate-900 font-inter ${orientationClass} ${className}`}
      style={{
        width: '100%',
        maxWidth: orientation === 'landscape' ? '297mm' : '210mm',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
};
