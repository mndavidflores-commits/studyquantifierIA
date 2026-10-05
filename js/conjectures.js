import { db } from './config.js';
import { escapeHtml } from './utils.js';

// ===================== DATE FORMATTING =====================
/**
 * Formats a timestamp into a human-readable "Thu, Oct 5 · 3:42 PM" string.
 * Falls back to raw toLocaleString on error.
 *
 * Video 4, booking test: specific, warm dates feel more real than machine
 * output like "10/5/2026, 3:42:18 PM".
 */
function formatHumanDateTime(timestamp) {
  if (!timestamp) return '-';
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return String(timestamp);

    const datePart = d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    const timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
    return `${datePart} · ${timePart}`;
  } catch {
    return String(timestamp);
  }
}

// ===================== FULL CONJECTURES VIEW =====================
export async function refreshConjecturesFull() {
  const wrap = document.getElementById('conjecturesListFull');
  if (!wrap) return;

  const conjectures = await db.conjectures
    .orderBy('timestamp')
    .reverse()
    .limit(100)
    .toArray();

  // Update the panel-title count dynamically (video 4: specific numbers > vague).
  // The panel-header h1 lives in index.html but we can enrich it here.
  const headerH1 = document.querySelector('#panelConjectures .panel-header h1');
  if (headerH1) {
    if (conjectures.length > 0) {
      headerH1.textContent = `Conjectures (${conjectures.length})`;
    } else {
      headerH1.textContent = 'Conjectures';
    }
  }

  // Video 4, booking test — sensory empty state instead of a cold "No conjectures."
  if (!conjectures.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">Your first conjecture is waiting.</p>
        <p class="empty-state-hint">Write one during a session using the <strong>Conjecture</strong> field — it'll appear here forever, alongside the subject and problem number it belongs to.</p>
      </div>
    `;
    return;
  }

  let html = `<table>
    <thead>
      <tr>
        <th>Conjecture</th>
        <th>Subject</th>
        <th>Problem</th>
        <th>Subtopic</th>
        <th>Date</th>
      </tr>
    </thead>
    <tbody>`;

  conjectures.forEach(c => {
    html += `<tr>
      <td>${escapeHtml(c.text)}</td>
      <td>${escapeHtml(c.subject || '')}</td>
      <td>${c.problemNumber ?? ''}</td>
      <td>${escapeHtml(c.subtopicId || '')}</td>
      <td>${escapeHtml(formatHumanDateTime(c.timestamp))}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}