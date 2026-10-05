import { db, state } from './config.js';
import { formatTime, formatDate, escapeHtml } from './utils.js';
import { editProblem } from './reviews.js';

// ===================== FULL HISTORY WITH ACCUMULATION =====================
const DATES_PER_BATCH = 10;
let renderedDateCount = 0;

// ===================== DATE FORMATTING =====================
function formatHeaderDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;

    const todayStr = formatDate(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);

    const shortForm = d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });

    if (iso === todayStr) return `Today · ${shortForm}`;
    if (iso === yesterdayStr) return `Yesterday · ${shortForm}`;

    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

// ===================== RENDER ONE DATE'S SESSIONS =====================
// Extracted into its own function so we can append batches of dates
// without re-rendering the ones already on screen.
function buildDateFragment(date, pomodoros, allSessions, conjecturesBySession) {
  const fragment = document.createDocumentFragment();

  const sessionCount = pomodoros.length;
  const dateHeader = document.createElement('div');
  dateHeader.className = 'history-date';
  const countLabel = sessionCount === 1 ? '1 session' : `${sessionCount} sessions`;
  dateHeader.textContent = `${formatHeaderDate(date)} · ${countLabel}`;
  fragment.appendChild(dateHeader);

  // Number sessions 1..N WITHIN the date (not globally).
  let indexInDate = 0;

  for (const pomo of pomodoros) {
    indexInDate++;
    const sessionLabel = `Session ${indexInDate}`;

    const problems = allSessions.filter(s => s.sessionId === pomo.id && s.type === 'problem');
    const conjectureCount = conjecturesBySession.get(pomo.id) || 0;
    const duration = pomo.pomodoroTime || 1;

    const correct    = problems.filter(p => p.result === 'correct').length;
    const incorrect  = problems.filter(p => p.result === 'incorrect').length;
    const unresolved = problems.filter(p => p.result === 'unresolved').length;

    const readingMins = Math.floor((pomo.readingTime || 0) / 60);
    const readingSecs = (pomo.readingTime || 0) % 60;

    const div = document.createElement('div');
    div.className = 'session-group';
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
              ${problems.length === 0
                ? `<tr><td colspan="4" style="text-align:center;padding:var(--space-md);color:var(--paper-mute);font-style:italic;">No problems registered in this session.</td></tr>`
                : problems.map(p => {
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
                  }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
    fragment.appendChild(div);
  }

  return fragment;
}

// ===================== MAIN RENDER =====================
export async function refreshHistory(reset = true) {
  const container = document.getElementById('historyContainer');
  if (!container) return;

  if (reset) {
    renderedDateCount = 0;
    container.innerHTML = '';
  }

  const allSessions = await db.sessions.orderBy('timestamp').reverse().toArray();

  // Empty state (video 4, sensory language).
  if (allSessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">Your first session will appear here.</p>
        <p class="empty-state-hint">Start one from <strong>Session</strong> and it'll be logged automatically — problems, conjectures, time, and results.</p>
      </div>
    `;
    return;
  }

  // Pre-index conjectures by sessionId.
  const allConjectures = await db.conjectures.toArray();
  const conjecturesBySession = new Map();
  for (const c of allConjectures) {
    if (!c.sessionId) continue;
    conjecturesBySession.set(c.sessionId, (conjecturesBySession.get(c.sessionId) || 0) + 1);
  }

  // Group by date.
  const grouped = {};
  allSessions.forEach(s => {
    const date = s.date || formatDate(s.timestamp);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(s);
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Which dates to render THIS pass (skip the ones already on screen).
  const nextBatch = sortedDates.slice(
    renderedDateCount,
    renderedDateCount + DATES_PER_BATCH
  );

  // Remove any previous "Load more" button — we'll add a fresh one at the end.
  const oldBtn = container.querySelector('.load-more-btn');
  if (oldBtn) oldBtn.remove();

  // Append new dates to the bottom (never wipe existing DOM).
  for (const date of nextBatch) {
    const pomodoros = grouped[date].filter(s => s.type === 'pomodoro');
    const fragment = buildDateFragment(date, pomodoros, allSessions, conjecturesBySession);
    container.appendChild(fragment);
  }

  renderedDateCount += nextBatch.length;

  // Add "Load more" if there are more dates remaining.
  const remaining = sortedDates.length - renderedDateCount;
  if (remaining > 0) {
    const btn = document.createElement('button');
    const nextBatchSize = Math.min(DATES_PER_BATCH, remaining);
    btn.textContent = nextBatchSize === 1
      ? 'Load 1 more date'
      : `Load ${nextBatchSize} more date${nextBatchSize === 1 ? '' : 's'}`;
    btn.className = 'small load-more-btn';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', () => refreshHistory(false));
    container.appendChild(btn);
  }
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