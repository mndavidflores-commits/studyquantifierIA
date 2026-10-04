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
 * Converts a Date, timestamp (number), or date string to a local "YYYY-MM-DD" string.
 *
 * Accepted inputs:
 *   - Date object                → used as-is
 *   - number (ms since epoch)    → new Date(number)
 *   - "YYYY-MM-DD"               → parsed as LOCAL midnight (not UTC)
 *   - ISO 8601 string            → new Date(input)
 *   - anything else              → new Date(input); invalid → today
 *
 * Returns a local "YYYY-MM-DD" string. Never throws.
 */
export function formatDate(input = new Date()) {
  let d;

  if (input instanceof Date) {
    d = input;
  } else if (typeof input === 'number' && Number.isFinite(input)) {
    // Explicit numeric timestamp (ms since epoch)
    d = new Date(input);
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // Date-only string → parse as LOCAL midnight, not UTC
    d = new Date(input + 'T00:00:00');
  } else if (input == null) {
    d = new Date();
  } else {
    d = new Date(input);
  }

  if (Number.isNaN(d.getTime())) {
    console.warn('formatDate received an invalid input:', input);
    d = new Date();
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===================== HTML ESCAPING =====================
/**
 * Escapes user-provided strings before injecting them into innerHTML.
 * Prevents XSS and keeps the output visually faithful when the input
 * contains `<`, `>`, `&`, `"` or `'`.
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}