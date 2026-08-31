import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getThreeMonthsAgoDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(dateInput?: string | Date | number | null, fallback = '-'): string {
  if (!dateInput && dateInput !== 0) return fallback;
  if (typeof dateInput === 'string') {
    const cleanDate = dateInput.trim();
    if (!cleanDate) return fallback;
    // YYYY-MM-DD or YYYY/MM/DD
    const matchYMD = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchYMD) {
      const [, year, month, day] = matchYMD;
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
    // DD-MM-YYYY or DD/MM/YYYY
    const matchDMY = cleanDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchDMY) {
      const [, day, month, year] = matchDMY;
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
    const d = new Date(cleanDate);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
    return cleanDate;
  }
  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
    return fallback;
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const day = String(dateInput.getDate()).padStart(2, '0');
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const year = dateInput.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return fallback;
}

export function formatDateDMY(dateInput?: string | Date | number | null, fallback = '-'): string {
  return formatDate(dateInput, fallback);
}


/**
 * Value for an `<input type="date">` from whatever the backend actually sends.
 *
 * Every date column reaches the renderer as a real `Date`, not a string: mssql returns Date
 * objects and Electron's IPC uses structured clone, which preserves them (there is no JSON step
 * anywhere on the path — see backend/src/ipc/wrap.js). The API types in lib/api.ts nonetheless
 * declare these fields as `string`, so `someRow.the_date.slice(0, 10)` type-checks fine and then
 * throws "slice is not a function" at runtime. That crash was reported by the user on the
 * Receipts entry-edit path (2026-08-31); the same call shape existed at ~20 sites across the
 * voucher pages, all latent.
 *
 * Uses toISOString, NOT the local getFullYear/getMonth/getDate parts: these are date-only columns
 * that arrive as UTC midnight, so the UTC calendar date is the intended one. Reading local parts
 * would land on the previous day for any user west of UTC.
 */
export function toDateInputValue(value?: string | Date | null): string {
  if (!value) return '';
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
