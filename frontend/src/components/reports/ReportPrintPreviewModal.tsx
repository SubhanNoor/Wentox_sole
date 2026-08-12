import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, ZoomIn, ZoomOut, RotateCcw, FileDown, FileSpreadsheet } from 'lucide-react';
import type { ReportOrientation } from '@/lib/reportConfig';
import { exportToPDF } from '@/lib/export';
import { paginateReportContent } from '@/lib/reportPagination';

const PX_PER_MM = 96 / 25.4;
const SHEET_PADDING_PX = 32; // matches the p-8 padding each sheet renders content with

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
  const [pageCount, setPageCount] = useState<number>(1);
  const masterRef = useRef<HTMLDivElement>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);

  const isLandscape = orientation === 'landscape';

  // Re-slice the report into page-sized sheets whenever its content or orientation changes.
  // Reads real, already-laid-out heights off the hidden master copy (masterRef) — the only
  // reliable way to know where a page would actually break — then clones the resulting chunks
  // into previewHostRef as plain DOM (not React-managed) so table headers can be repeated
  // per-page without fighting React's reconciliation.
  useLayoutEffect(() => {
    const master = masterRef.current;
    const host = previewHostRef.current;
    if (!isOpen || !master || !host) return;

    const pageHeightMm = isLandscape ? 210 : 297;
    const pageHeightPx = pageHeightMm * PX_PER_MM - SHEET_PADDING_PX * 2;
    const pages = paginateReportContent(master, pageHeightPx);

    host.innerHTML = '';
    pages.forEach((pageEl, idx) => {
      const sheet = document.createElement('div');
      sheet.className = 'report-preview-sheet shadow-2xl rounded-sm bg-white border border-slate-300 text-slate-900';
      sheet.style.width = isLandscape ? '297mm' : '210mm';
      sheet.style.minHeight = `${pageHeightMm}mm`;
      sheet.style.padding = `${SHEET_PADDING_PX}px`;
      sheet.style.boxSizing = 'border-box';
      sheet.style.position = 'relative';
      sheet.appendChild(pageEl);

      const badge = document.createElement('div');
      badge.className = 'report-preview-page-badge';
      badge.textContent = `Page ${idx + 1} of ${pages.length}`;
      badge.style.cssText =
        'position:absolute;top:6px;right:10px;font-size:10px;font-family:monospace;color:#94a3b8;';
      sheet.appendChild(badge);

      host.appendChild(sheet);
    });
    setPageCount(pages.length);
  }, [children, isLandscape, isOpen]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    const filename = `${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`;
    await exportToPDF(filename, { landscape: isLandscape });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-sm animate-in fade-in duration-200 report-modal-container">
      {/* Dynamic @page orientation rule */}
      <style>{`
        @media print {
          @page {
            /* A4 stated explicitly, not just the orientation. Without a paper size the print
               dialog's own default wins — Letter on a US-configured Windows — which silently
               reflows a report this toolbar describes as A4 and moves every page break. */
            size: A4 ${isLandscape ? 'landscape' : 'portrait'};
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
              Mode: A4 {isLandscape ? 'Landscape (297mm × 210mm)' : 'Portrait (210mm × 297mm)'} • Scale: {zoomLevel}% • {pageCount} page{pageCount === 1 ? '' : 's'}
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
              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors cursor-pointer"
            >
              <ZoomOut size={16} />
            </button>
            <span className="px-2 text-xs font-mono font-bold min-w-[45px] text-center text-amber-400">
              {zoomLevel}%
            </span>
            <button
              onClick={() => setZoomLevel(prev => Math.min(150, prev + 10))}
              title="Zoom In"
              className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors cursor-pointer"
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

      {/* Hidden master copy: the real, single-flow content. Invisible on screen — it only exists
          so (a) the pagination effect can measure real laid-out heights off it, and (b) the
          browser's print engine (window.print / printToPDF) has one continuous document to
          paginate for real, which is the source of truth for the actual printed/exported output.
          The visible preview below is a screen-only approximation built from it. */}
      <div
        ref={masterRef}
        className="report-modal-print-source p-8 text-slate-900 report-modal-paper"
        style={{ width: isLandscape ? '297mm' : '210mm' }}
        id="report-modal-print-content"
      >
        {children}
      </div>

      {/* Interactive multi-page preview: one stacked sheet per page, built by the pagination
          effect above so a report that overflows one page visually shows as separate pages. */}
      <div className="flex-1 overflow-auto p-8 flex justify-center bg-slate-950/70 report-modal-scroll-wrapper" data-no-print>
        <div
          ref={previewHostRef}
          className="flex flex-col items-center gap-6 transition-transform duration-200 origin-top"
          style={{ transform: `scale(${zoomLevel / 100})` }}
        />
      </div>
    </div>,
    document.body
  );
};
