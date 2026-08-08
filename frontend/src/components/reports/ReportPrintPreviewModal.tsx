import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, ZoomIn, ZoomOut, RotateCcw, FileDown, FileSpreadsheet } from 'lucide-react';
import type { ReportOrientation } from '@/lib/reportConfig';
import { exportToPDF } from '@/lib/export';

interface ReportPrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  orientation?: ReportOrientation;
  onExportExcel?: () => void;
  children: React.ReactNode;
}

export const ReportPrintPreviewModal: React.FC<ReportPrintPreviewModalProps> = ({
  isOpen,
  onClose,
  title,
  orientation = 'portrait',
  onExportExcel,
  children,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    exportToPDF();
  };

  const isLandscape = orientation === 'landscape';

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-sm animate-in fade-in duration-200 report-modal-container">
      {/* Dynamic @page orientation rule */}
      <style>{`
        @media print {
          @page {
            size: ${isLandscape ? 'landscape' : 'portrait'};
            margin: 8mm;
          }
        }
      `}</style>

      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-800 text-white shadow-lg report-modal-topbar" data-no-print>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--brand-gold)] text-slate-950 flex items-center justify-center font-bold">
            <Printer size={18} />
          </div>
          <div>
            <h3 className="font-lora font-bold text-base text-white">{title}</h3>
            <p className="text-xs text-slate-400 font-mono">
              Mode: A4 {isLandscape ? 'Landscape (297mm × 210mm)' : 'Portrait (210mm × 297mm)'} • Scale: {zoomLevel}%
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-800 rounded-xl p-1 border border-slate-700">
            <button
              onClick={() => setZoomLevel(prev => Math.max(60, prev - 10))}
              title="Zoom Out"
              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
            >
              <ZoomOut size={16} />
            </button>
            <span className="px-2 text-xs font-mono font-bold min-w-[45px] text-center text-amber-400">
              {zoomLevel}%
            </span>
            <button
              onClick={() => setZoomLevel(prev => Math.min(150, prev + 10))}
              title="Zoom In"
              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={() => setZoomLevel(100)}
              title="Reset Zoom"
              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors border-l border-slate-700 ml-1"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Export & Print Buttons */}
          {onExportExcel && (
            <button
              onClick={onExportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-xs"
            >
              <FileSpreadsheet size={15} /> Export Excel
            </button>
          )}

          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-xs"
          >
            <FileDown size={15} /> Export PDF
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--brand-gold)] hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md transform hover:scale-105"
          >
            <Printer size={16} /> Print Document
          </button>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-xl transition-colors ml-2 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Interactive Paper Preview Container */}
      <div className="flex-1 overflow-auto p-8 flex justify-center bg-slate-950/70 report-modal-scroll-wrapper">
        <div
          className="transition-transform duration-200 origin-top shadow-2xl rounded-sm bg-white border border-slate-300 p-8 text-slate-900 report-modal-paper"
          style={{
            transform: `scale(${zoomLevel / 100})`,
            width: isLandscape ? '297mm' : '210mm',
            minHeight: isLandscape ? '210mm' : '297mm',
            marginBottom: zoomLevel > 100 ? `${(zoomLevel - 100) * 4}px` : '0px',
          }}
          id="report-modal-print-content"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
