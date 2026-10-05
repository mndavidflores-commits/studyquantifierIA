import { db, state } from './config.js';
import { formatTime, formatDate, escapeHtml } from './utils.js';
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
  // Global counter so sessions get a stable sequential number
  // regardless of pagination — most recent first.
  let globalSessionIndex = 0;

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

      // Short label: "Session N" (most recent = highest number, so the
      // session at the top of the list gets the biggest N).
      globalSessionIndex++;
      const sessionLabel = `Session ${globalSessionIndex}`;

      const openClass = globalSessionIndex === 1 ? ' open' : '';

      // Result counts for the quick-stats line
      const correct    = problems.filter(p => p.result === 'correct').length;
      const incorrect  = problems.filter(p => p.result === 'incorrect').length;
      const unresolved = problems.filter(p => p.result === 'unresolved').length;

      // Reading time formatted as M:SS
      const readingMins = Math.floor((pomo.readingTime || 0) / 60);
      const readingSecs = (pomo.readingTime || 0) % 60;

      const div = document.createElement('div');
      div.className = 'session-group' + openClass;
      div.dataset.pomoid = pomo.id;

      div.innerHTML = `
        <div class="session-header">
          <span class="session-label">
            <strong>${escapeHtml(sessionLabel)}</strong>
          </span>
          <span class="session-meta mono">
            ${formatTime(duration)}
            <span class="dot">·</span>
            ${escapeHtml(pomo.subject || 'no subject')}
            <span class="dot">·</span>
            ${escapeHtml(pomo.mode || '-')}
            <span class="dot">·</span>
            Ex:${problems.length}
          </span>
        </div>
        <div class="session-content">
          <div class="session-detail-grid">
            <div>
              <span class="detail-label">Phase</span>
              <span class="detail-value">${escapeHtml(pomo.phase || '-')}</span>
            </div>
            <div>
              <span class="detail-label">Mode</span>
              <span class="detail-value">${escapeHtml(pomo.mode || '-')}</span>
            </div>
            <div>
              <span class="detail-label">Subject</span>
              <span class="detail-value">${escapeHtml(pomo.subject || '-')}</span>
            </div>
            <div>
              <span class="detail-label">Subtopic</span>
              <span class="detail-value">${escapeHtml(pomo.subtopicName || pomo.subtopicId || '-')}</span>
            </div>
            <div>
              <span class="detail-label">Exercises</span>
              <span class="detail-value">
                ${problems.length}
                <span class="result-pills">
                  <span class="result-c" title="Correct">${correct}</span>
                  <span class="result-i" title="Incorrect">${incorrect}</span>
                  <span class="result-u" title="Unresolved">${unresolved}</span>
                </span>
              </span>
            </div>
            <div>
              <span class="detail-label">Conjectures</span>
              <span class="detail-value">${conjectureCount}</span>
            </div>
            <div>
              <span class="detail-label">Reading</span>
              <span class="detail-value mono">${readingMins}:${String(readingSecs).padStart(2, '0')}</span>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Result</th><th>Time</th><th>Error</th></tr>
              </thead>
              <tbody>
                ${problems.map(p => {
                  const badgeClass = p.result === 'correct' ? 'result-c'
                                   : p.result === 'incorrect' ? 'result-i'
                                   : 'result-u';
                  const badgeLetter = p.result === 'correct' ? 'C'
                                    : p.result === 'incorrect' ? 'I'
                                    : 'U';
                  return `
                    <tr class="editable-problem" data-problem-id="${p.id}" style="cursor:pointer;">
                      <td>${p.problemNumber || '-'}</td>
                      <td><span class="${badgeClass}">${badgeLetter}</span></td>
                      <td class="mono">${formatTime(p.timeSeconds)}</td>
                      <td>${escapeHtml(p.errorCode || '')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
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