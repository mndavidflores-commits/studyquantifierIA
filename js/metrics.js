import { db, state } from './config.js';
import { formatTime, formatHMS, todayLocal, formatDate } from './utils.js';
import { renderHeatmap, renderProblemsChart, renderFSRSChart } from './charts.js';

// How many hours fill the "level" progress bar to 100%.
// Adjust this if you want a shorter or longer climb.
const HOURS_FOR_FULL_LEVEL = 100;

// ===================== GENERAL METRICS (top strip) =====================
export async function refreshMetrics() {
  const problems = await db.sessions.where('type').equals('problem').toArray();
  const correct = problems.filter(s => s.result === 'correct').length;
  const incorrect = problems.filter(s => s.result === 'incorrect').length;
  const total = problems.length;
  const totalTime = problems.reduce((a, s) => a + (s.timeSeconds || 0), 0);
  const totalConjectures = await db.conjectures.count();
  const conjecturesPerMin = totalTime
    ? (totalConjectures / (totalTime / 60)).toFixed(2)
    : '0';

  const container = document.getElementById('metricsGeneral');
  if (container) {
    container.innerHTML = `
      <span>Accuracy: ${correct + incorrect > 0 ? Math.round(correct / (correct + incorrect) * 100) : 0}%</span>
      <span>Avg time: ${total ? formatTime(totalTime / total) : '-'}</span>
      <span>Conjectures/min: ${conjecturesPerMin}</span>
      <span>Total: ${total}</span>
    `;
  }
}

// ===================== FULL METRICS PANEL =====================
export async function refreshMetricsPanel() {
  const sessions = await db.sessions.toArray();
  const conjectures = await db.conjectures.toArray();
  const reviews = await db.reviews.toArray();

  // ---- Registration date (earliest session) ----
  const registrationEl = document.getElementById('registrationDate');
  if (sessions.length > 0) {
    const first = sessions.reduce((min, s) =>
      new Date(s.timestamp || s.date) < new Date(min.timestamp || min.date) ? s : min
    );
    const date = new Date(first.timestamp || first.date);
    if (registrationEl) registrationEl.textContent = date.toLocaleDateString();
  } else {
    if (registrationEl) registrationEl.textContent = 'No data';
  }

  // ---- Streak ----
  // Counts today as a "grace" day: if you studied yesterday but not today
  // yet, the streak still shows as ongoing. Once you study today it ticks up.
  // If you skipped yesterday AND today, streak is 0.
  const studiedDays = new Set(sessions.map(s => s.date || formatDate(s.timestamp)));
  const todayStr = todayLocal();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);

  let streak = 0;
  let cursor = new Date();
  if (studiedDays.has(todayStr)) {
    // Started today — count backwards
    cursor = new Date();
  } else if (studiedDays.has(yesterdayStr)) {
    // Not today yet, but yesterday counts
    cursor = yesterday;
  } else {
    // Gap — streak is 0
    cursor = null;
  }

  while (cursor) {
    const dateStr = formatDate(cursor);
    if (studiedDays.has(dateStr)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  const streakEl = document.getElementById('currentStreak');
  if (streakEl) streakEl.textContent = streak;

  // ---- Total sessions ----
  const totalSessions = sessions.filter(s => s.type === 'pomodoro').length;
  const sessionsEl = document.getElementById('totalSessions');
  if (sessionsEl) sessionsEl.textContent = totalSessions;

  // ---- Type A problems ----
  const problemsA = sessions.filter(s => s.type === 'problem' && s.mode === 'A');
  const problemsAEl = document.getElementById('totalProblemsA');
  if (problemsAEl) problemsAEl.textContent = problemsA.length;

  // ---- Total studied time ----
  const totalSeconds = sessions
    .filter(s => s.type === 'pomodoro')
    .reduce((acc, s) => acc + (s.pomodoroTime || 0), 0);
  const totalTimeEl = document.getElementById('totalTime');
  if (totalTimeEl) totalTimeEl.textContent = formatHMS(totalSeconds);

  // ---- Result counters ----
  const correct = sessions.filter(s => s.type === 'problem' && s.result === 'correct').length;
  const incorrect = sessions.filter(s => s.type === 'problem' && s.result === 'incorrect').length;
  const unresolved = sessions.filter(s => s.type === 'problem' && s.result === 'unresolved').length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('totalCorrect', correct);
  setText('totalIncorrect', incorrect);
  setText('totalUnresolved', unresolved);
  setText('totalReviews', reviews.length);
  setText('totalConjectures', conjectures.length);

  // ---- Hours studied today ----
  const today = todayLocal();
  const todaySessions = sessions.filter(s =>
    s.type === 'pomodoro' && (s.date || formatDate(s.timestamp)) === today
  );
  const hoursToday = todaySessions.reduce((acc, s) => acc + (s.pomodoroTime || 0), 0) / 3600;
  setText('hoursToday', hoursToday.toFixed(1) + ' h');

  // ---- Level progress ----
  const totalHours = totalSeconds / 3600;
  const levelPercentage = Math.min(100, Math.round((totalHours / HOURS_FOR_FULL_LEVEL) * 100));
  const levelEl = document.getElementById('levelProgress');
  if (levelEl) levelEl.style.width = levelPercentage + '%';

  // ---- Charts + dynamic chart-filter buttons ----
  await renderChartFilters(sessions);
  if (document.getElementById('chartProblems')) await renderProblemsChart();
  await renderHeatmap(sessions);
  if (document.getElementById('chartFSRS')) await renderFSRSChart();
}

// ===================== DYNAMIC CHART FILTER BUTTONS =====================
async function renderChartFilters(sessions) {
  const container = document.getElementById('chartFilters');
  if (!container) return;

  const subjects = [...new Set(
    sessions
      .filter(s => s.type === 'problem' && s.subject)
      .map(s => s.subject)
  )].sort();

  if (subjects.length === 0) {
    container.innerHTML = '';
    state.selectedChartSubject = null;
    return;
  }

  if (!subjects.includes(state.selectedChartSubject)) {
    state.selectedChartSubject = subjects[0];
  }

  container.innerHTML = subjects
    .map(s => `
      <button
        class="chart-filter-btn${s === state.selectedChartSubject ? ' active' : ''}"
        data-subject="${escapeHtml(s)}"
      >${escapeHtml(s)}</button>
    `)
    .join('');
}

// ===================== HTML ESCAPING =====================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}