import { db } from './config.js';
import { escapeHtml } from './utils.js';

// ===================== FULL CONJECTURES VIEW =====================
export async function refreshConjecturesFull() {
  const wrap = document.getElementById('conjecturesListFull');
  if (!wrap) return;

  const conjectures = await db.conjectures
    .orderBy('timestamp')
    .reverse()
    .limit(100)
    .toArray();

  if (!conjectures.length) {
    wrap.innerHTML = 'No conjectures.';
    return;
  }

  let html = `<table>
    <tr>
      <th>Conjecture</th>
      <th>Subject</th>
      <th>Problem</th>
      <th>Subtopic</th>
      <th>Date</th>
    </tr>`;

  conjectures.forEach(c => {
    const d = new Date(c.timestamp);
    html += `<tr>
      <td>${escapeHtml(c.text)}</td>
      <td>${escapeHtml(c.subject || '')}</td>
      <td>${c.problemNumber || ''}</td>
      <td>${escapeHtml(c.subtopicId || '')}</td>
      <td>${d.toLocaleString()}</td>
    </tr>`;
  });

  html += '</table>';
  wrap.innerHTML = html;
}