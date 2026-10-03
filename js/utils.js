// ===================== TIME FORMATTING =====================

/**
 * Formats seconds as "MM:SS.d" (minutes, seconds, tenths).
 * Example: 125.4 → "02:05.4"
 */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const d = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

/**
 * Formats seconds as "HH:MM:SS".
 * Example: 3725 → "01:02:05"
 */
export function formatHMS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ===================== TOAST =====================
let toastTimeout = null;

export function showToast(message, duration = 2600) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}

// ===================== LOCAL DATE HELPERS =====================

/**
 * Returns today's date as a local "YYYY-MM-DD" string.
 * Uses local timezone, not UTC.
 */
export function todayLocal() {
  return formatDate(new Date());
}

/**
 * Converts a Date, timestamp, or date string to a local "YYYY-MM-DD" string.
 * - Date objects are used as-is.
 * - Date-only strings ("2026-09-13") are parsed as local midnight, not UTC midnight.
 * - Anything else is passed to `new Date()`.
 */
export function formatDate(input = new Date()) {
  let d;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    d = new Date(input + 'T00:00:00');
  } else {
    d = new Date(input);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}