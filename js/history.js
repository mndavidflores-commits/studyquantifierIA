import { db, state } from './config.js';
import { formatTime, formatDate } from './utils.js';
import { editProblem } from './reviews.js';

// ===================== FULL HISTORY WITH PAGINATION =====================
const DATES_PER_PAGE = 10;
let dateOffset = 0;
let totalDates = 0;

export async function refreshHistory(reset = true) {
  if (reset) dateOffset = 0;

  const container = document.getElementById('historyContainer');
  if (!container) return;

  const allSessions = await db.sessions.orderBy('timestamp').reverse().toArray();

  // Pre-index all conjectures by sessionId — single query instead of N+1.
  const allConjectures = await db.conjectures.toArray();
  const conjecturesBySession = new Map();
  for (const c of allConjectures) {
    if (!c.sessionId) continue;
    conjecturesBySession.set(c.sessionId, (conjecturesBySession.get(c.sessionId) || 0) + 1);
  }

  // Group by date
  const grouped = {};
  allSessions.forEach(s => {
    const date = s.date || formatDate(s.timestamp);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(s);
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  totalDates = sortedDates.length;
  const visibleDates = sortedDates.slice(dateOffset, dateOffset + DATES_PER_PAGE);

  const fragment = document.createDocumentFragment();
  // Track index across all visible dates so only the very first session opens.
  let sessionIndex = 0;

  for (const date of visibleDates) {
    const dateHeader = document.createElement('div');
    dateHeader.className = 'history-date';
    dateHeader.textContent = date;
    fragment.appendChild(dateHeader);

    const pomodoros = grouped[date].filter(s => s.type === 'pomodoro');

    for (const pomo of pomodoros) {
      const problems = allSessions.filter(s => s.sessionId === pomo.id && s.type === 'problem');
      const conjectureCount = conjecturesBySession.get(pomo.id) || 0;
      const duration = pomo.pomodoroTime || 1;

      const openClass = sessionIndex === 0 ? ' open' : '';
      sessionIndex++;

      const div = document.createElement('div');
      div.className = 'session-group' + openClass;
      div.dataset.pomoid = pomo.id;
      div.innerHTML = `
        <div class="session-header">
          <span>
            <strong>${pomo.pomodoroLabel || 'pomodoro_' + pomo.id}</strong>
          </span>
          <span>
            ${formatTime(duration)} | ${pomo.subject || 'no subject'} | ${pomo.mode || ''} | Ex:${problems.length}
          </span>
        </div>
        <div class="session-content">
          <p style="padding:6px 10px; font-size:0.75rem; color:var(--text2);">
            Phase: ${pomo.phase || '-'} | Mode: ${pomo.mode || '-'} | Subject: ${pomo.subject || '-'} | Subtopic: ${pomo.subtopicName || pomo.subtopicId || '-'}
          </p>
          <p style="padding:0 10px; font-size:0.75rem; color:var(--text2);">
            Exercises: ${problems.length} (${problems.filter(p => p.result === 'correct').length} correct, ${problems.filter(p => p.result === 'incorrect').length} incorrect, ${problems.filter(p => p.result === 'unresolved').length} unresolved)
          </p>
          <p style="padding:0 10px 6px; font-size:0.75rem; color:var(--text2);">
            Conjectures: ${conjectureCount} | Ex/min: ${(problems.length / (duration / 60)).toFixed(1)} | Conj/min: ${(conjectureCount / (duration / 60)).toFixed(1)} | Reading: ${Math.floor((pomo.readingTime || 0) / 60)}:${String((pomo.readingTime || 0) % 60).padStart(2, '0')}
          </p>
          <table>
            <tr><th>#</th><th>Result</th><th>Time</th><th>Error</th></tr>
            ${problems.map(p => `
              <tr class="editable-problem" data-problem-id="${p.id}" style="cursor:pointer;">
                <td>${p.problemNumber}</td>
                <td>${p.result}</td>
                <td>${formatTime(p.timeSeconds)}</td>
                <td>${p.errorCode || ''}</td>
              </tr>
            `).join('')}
          </table>
        </div>
      `;
      fragment.appendChild(div);
    }
  }

  if (dateOffset + DATES_PER_PAGE < totalDates) {
    const btn = document.createElement('button');
    btn.textContent = 'Load more dates';
    btn.className = 'small';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', () => {
      dateOffset += DATES_PER_PAGE;
      refreshHistory(false);
    });
    fragment.appendChild(btn);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

// ===================== EVENT DELEGATION =====================
const historyContainer = document.getElementById('historyContainer');
if (historyContainer) {
  historyContainer.addEventListener('click', (e) => {
    const tr = e.target.closest('.editable-problem');
    if (tr) {
      e.stopPropagation();
      editProblem(tr.dataset.problemId);
      return;
    }

    const header = e.target.closest('.session-header');
    if (header) {
      header.parentElement.classList.toggle('open');
    }
  });
}