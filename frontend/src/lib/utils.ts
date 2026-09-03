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

/**
 * A timestamp as dd/mm/yyyy plus a 24-hour clock — for "last backup at ..." style stamps.
 *
 * Exists because `new Date(x).toLocaleString()` with no locale renders AMERICAN here. Electron
 * sets `--lang=en-GB` (backend/electron/main.js) so the native <input type="date"> pickers show
 * dd/mm/yyyy, but that switch only moves Chromium's UI locale — ICU's default is untouched:
 *
 *     navigator.language                             -> "en-GB"
 *     Intl.DateTimeFormat().resolvedOptions().locale -> "en-US"
 *     new Date(2026, 7, 31).toLocaleString()         -> "8/31/2026, 2:05:09 PM"
 *
 * So never rely on the default locale for a date. Build the parts explicitly, as formatDate does,
 * and the output cannot drift with the host's regional settings.
 */
export function formatDateTime(
  value?: string | Date | number | null,
  fallback = '-',
  opts: { seconds?: boolean } = {},
): string {
  if (!value && value !== 0) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    + (opts.seconds === false ? '' : `:${pad(d.getSeconds())}`);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${time}`;
}

/**
 * Carton quantities carry one decimal place (migration 030). Two helpers go with that.
 *
 * Display: a summed carton total can pick up float noise — 0.1 + 0.2 is 0.30000000000000004 — so
 * anything shown to the user goes through here rather than being interpolated raw. Whole values
 * print without a pointless ".0".
 */
export function formatCartons(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Why a carton quantity can't be used, or null when it's fine — mirroring the server's rule in
 * backend/src/utils/cartons.js so the entry form can say so immediately instead of the user
 * discovering it on save.
 *
 * Pairs stay whole: stock is counted in pairs and a pair is indivisible, so `cartons * packing`
 * has to land on an integer. Compared with a tolerance because cartons is a float — 0.1 * 3 is
 * 0.30000000000000004 in IEEE 754, and an exact test would reject quantities that are whole to
 * any meaningful precision.
 */
export function cartonsProblem(cartons: number, packing: number): string | null {
  if (!Number.isFinite(cartons) || cartons <= 0) return null; // handled by the existing > 0 checks
  const whole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;
  if (!whole(cartons * 10)) {
    return `Cartons can have at most one decimal place — ${cartons} would be rounded when saved.`;
  }
  if (packing > 0 && !whole(cartons * packing)) {
    const pairs = Math.round(cartons * packing * 10) / 10;
    return `${formatCartons(cartons)} cartons of ${packing} pairs each comes to ${pairs} pairs. `
      + 'Stock is counted in whole pairs — enter a carton quantity that divides evenly.';
  }
  return null;
}
