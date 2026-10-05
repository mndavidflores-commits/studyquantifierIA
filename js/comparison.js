import { db, state } from './config.js';
import { todayLocal, formatDate, formatHMS, escapeHtml } from './utils.js';

let comparisonChart = null;

// ===================== COLOR HELPERS =====================
/**
 * Reads the design system colors from CSS custom properties so charts
 * follow the active theme. Called at the start of every render.
 * Mirrors the helper in `charts.js` — kept local to avoid a cross-import
 * that would pull the whole charts module into comparison.js.
 */
function getChartColors() {
  const root = getComputedStyle(document.documentElement);
  const get = (v) => root.getPropertyValue(v).trim();

  return {
    accent:      get('--accent')      || '#92140C',
    accentSoft:  get('--accent-soft') || 'rgba(146,20,12,0.12)',
    ok:          get('--ok')          || '#6E9075',
    pending:     get('--pending')     || '#6D72C3',
    paper:       get('--paper')       || '#FFF8F0',
    paperSoft:   get('--paper-soft')  || 'rgba(255,248,240,0.7)',
    paperMute:   get('--paper-mute')  || 'rgba(255,248,240,0.45)',
    ink:         get('--ink')         || '#1E1E24',
    inkSoft:     get('--ink-soft')    || '#26262D',
    inkBorder:   get('--ink-border')  || 'rgba(255,248,240,0.08)'
  };
}

// ===================== RESIZE HOOK (used by panels.js) =====================
export function resizeComparisonChart() {
  if (comparisonChart) comparisonChart.resize();
}

// ===================== ISO WEEK HELPER =====================
/**
 * Returns the current ISO-8601 week in the `YYYY-Www` format that
 * <input type="week"> expects. Week 1 = the week containing the year's
 * first Thursday.
 */
function getCurrentISOWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;                  // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);          // move to Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ===================== SUBJECT SELECTOR =====================
export async function populateComparisonSubjects() {
  const sel = document.getElementById('comparisonSubject');
  if (!sel) return;

  const syllabusSubjects = [...new Set(state.currentSyllabus.map(t => t.subject))];
  const dbSubjects = await db.subjects.toArray();
  const all = [...new Set([...syllabusSubjects, ...dbSubjects.map(s => s.name)])].sort();

  const previous = sel.value || 'All';
  sel.innerHTML = '<option value="All">All</option>'
    + all.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  const stillExists = [...sel.options].some(o => o.value === previous);
  sel.value = stillExists ? previous : 'All';
}

// ===================== DATA LOADER =====================
async function loadDataset() {
  const [sessions, conjectures] = await Promise.all([
    db.sessions.toArray(),
    db.conjectures.toArray()
  ]);
  return { sessions, conjectures };
}

// ===================== DAILY SUMMARY =====================
function summarizeDay(dataset, date, subjectFilter = 'All') {
  const { sessions, conjectures } = dataset;

  const matchesSubject = (item) => subjectFilter === 'All' || item.subject === subjectFilter;
  const matchesDate = (item) => (item.date || formatDate(item.timestamp)) === date;

  const pomodoros = sessions.filter(s => s.type === 'pomodoro' && matchesDate(s) && matchesSubject(s));
  const problems  = sessions.filter(s => s.type === 'problem'  && matchesDate(s) && matchesSubject(s));
  const conjecturesForDay = conjectures.filter(c => c.date === date && matchesSubject(c));

  const totalTime = pomodoros.reduce((a, s) => a + (s.pomodoroTime || 0), 0);
  const correct    = problems.filter(p => p.result === 'correct').length;
  const incorrect  = problems.filter(p => p.result === 'incorrect').length;
  const unresolved = problems.filter(p => p.result === 'unresolved').length;
  const distractions = pomodoros.reduce((a, s) => a + (s.summaryDistractions || 0), 0);

  const bySubject = {};
  pomodoros.forEach(s => {
    const key = s.subject || 'No subject';
    if (!bySubject[key]) bySubject[key] = { hours: 0, exercises: 0, sessions: 0 };
    bySubject[key].hours += (s.pomodoroTime || 0) / 3600;
    bySubject[key].sessions += 1;
  });
  problems.forEach(p => {
    const key = p.subject || 'No subject';
    if (!bySubject[key]) bySubject[key] = { hours: 0, exercises: 0, sessions: 0 };
    bySubject[key].exercises += 1;
  });

  return {
    date,
    sessions: pomodoros.length,
    totalTime,
    totalProblems: problems.length,
    correct,
    incorrect,
    unresolved,
    conjectures: conjecturesForDay.length,
    distractions,
    bySubject
  };
}

// ===================== HTML FORMATTER =====================
function formatSummary(summary) {
  const time = formatHMS(summary.totalTime || 0);

  let html = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
      <div><strong>Problems:</strong> ${summary.totalProblems}</div>
      <div><strong>Correct:</strong> ${summary.correct}</div>
      <div><strong>Incorrect:</strong> ${summary.incorrect}</div>
      <div><strong>Unresolved:</strong> ${summary.unresolved}</div>
      <div><strong>Sessions:</strong> ${summary.sessions}</div>
      <div><strong>Time:</strong> ${time}</div>
      <div><strong>Conjectures:</strong> ${summary.conjectures}</div>
      <div><strong>Distractions:</strong> ${summary.distractions}</div>
    </div>
  `;

  const subjects = Object.entries(summary.bySubject);
  if (subjects.length > 0) {
    html += `
      <table style="margin-top:10px; width:100%;">
        <tr><th>Subject</th><th>Hours</th><th>Exercises</th><th>Sessions</th></tr>
        ${subjects.map(([subject, data]) => `
          <tr>
            <td>${escapeHtml(subject)}</td>
            <td>${data.hours.toFixed(2)} h</td>
            <td>${data.exercises}</td>
            <td>${data.sessions}</td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  return html;
}

// ===================== TODAY SECTION =====================
async function renderToday(dataset) {
  const container = document.getElementById('comparisonToday');
  if (!container) return;

  const filter = document.getElementById('comparisonSubject').value;
  const summary = summarizeDay(dataset, todayLocal(), filter);
  container.innerHTML = formatSummary(summary);
}

// ===================== SELECTED DAY SECTION =====================
async function renderSelectedDay(dataset) {
  const container = document.getElementById('comparisonDay');
  const dateInput = document.getElementById('comparisonDate');
  if (!container || !dateInput) return;

  // Fallback: if the user cleared the date, restore to today.
  if (!dateInput.value) dateInput.value = todayLocal();

  const date = dateInput.value;
  const filter = document.getElementById('comparisonSubject').value;
  const summary = summarizeDay(dataset, date, filter);
  container.innerHTML = formatSummary(summary);

  await renderComparisonChart(dataset, date, filter);
}

// ===================== COMPARISON CHART (7-day window) =====================
async function renderComparisonChart(dataset, selectedDate, subjectFilter) {
  const ctx = document.getElementById('comparisonChartDay')?.getContext('2d');
  if (!ctx) return;

  const C = getChartColors();

  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - i);
    dates.push(formatDate(d));
  }

  const hours = [];
  const exercises = [];
  for (const date of dates) {
    const summary = summarizeDay(dataset, date, subjectFilter);
    hours.push(Number((summary.totalTime / 3600).toFixed(2)));
    exercises.push(summary.totalProblems);
  }

  const labels = dates.map(d => d.slice(5));

  if (comparisonChart) {
    comparisonChart.data.labels = labels;
    comparisonChart.data.datasets[0].data = hours;
    comparisonChart.data.datasets[1].data = exercises;
    comparisonChart.data.datasets[0].backgroundColor = C.accent;
    comparisonChart.data.datasets[0].borderColor = C.accent;
    comparisonChart.data.datasets[1].backgroundColor = C.pending;
    comparisonChart.data.datasets[1].borderColor = C.pending;
    comparisonChart.options.scales.x.ticks.color = C.paperMute;
    comparisonChart.options.scales.y.ticks.color = C.paperMute;
    comparisonChart.options.scales.x.grid.color = C.inkBorder;
    comparisonChart.options.scales.y.grid.color = C.inkBorder;
    comparisonChart.options.plugins.tooltip.backgroundColor = C.inkSoft;
    comparisonChart.options.plugins.tooltip.titleColor = C.paper;
    comparisonChart.options.plugins.tooltip.bodyColor = C.paperSoft;
    comparisonChart.options.plugins.tooltip.borderColor = C.inkBorder;
    comparisonChart.options.plugins.legend.labels.color = C.paperSoft;
    comparisonChart.update();
    return;
  }

  comparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Hours',
          data: hours,
          backgroundColor: C.accent,
          hoverBackgroundColor: C.accent, // hover handled by opacity via CSS-like easing
          borderColor: C.accent,
          borderWidth: 1,
          borderRadius: 2
        },
        {
          label: 'Exercises',
          data: exercises,
          backgroundColor: C.pending,
          hoverBackgroundColor: C.pending,
          borderColor: C.pending,
          borderWidth: 1,
          borderRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        tooltip: {
          backgroundColor: C.inkSoft,
          titleColor: C.paper,
          bodyColor: C.paperSoft,
          borderColor: C.inkBorder,
          borderWidth: 1,
          padding: 10
        },
        legend: {
          display: true,
          labels: {
            color: C.paperSoft,
            font: { family: 'Inter', size: 11 },
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true
          }
        }
      },
      scales: {
        x: {
          ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 11 } },
          grid: { color: C.inkBorder, borderDash: [2, 2], drawBorder: false }
        },
        y: {
          ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 11 } },
          grid: { color: C.inkBorder, borderDash: [2, 2], drawBorder: false }
        }
      }
    }
  });
}

// ===================== WEEK SECTION =====================
async function renderWeek(dataset) {
  const container = document.getElementById('comparisonWeekSummary');
  const weekInput = document.getElementById('comparisonWeek');
  if (!container || !weekInput) return;

  // Fallback: if the user cleared the week, restore to current ISO week.
  if (!weekInput.value) weekInput.value = getCurrentISOWeek();

  const value = weekInput.value;
  let start, end;

  if (value) {
    const [year, week] = value.split('-W').map(Number);
    const firstDay = new Date(year, 0, 1);
    const daysUntilMonday = (firstDay.getDay() + 6) % 7;
    firstDay.setDate(firstDay.getDate() - daysUntilMonday + (week - 1) * 7);
    start = new Date(firstDay);
    end = new Date(firstDay);
    end.setDate(end.getDate() + 6);
  } else {
    start = new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start);
    end.setDate(end.getDate() + 6);
  }

  const startStr = formatDate(start);
  const endStr = formatDate(end);
  const filter = document.getElementById('comparisonSubject').value;

  const { sessions } = dataset;
  const inWeek = (item) => {
    const d = item.date || formatDate(item.timestamp);
    return d >= startStr && d <= endStr && (filter === 'All' || item.subject === filter);
  };

  const pomodoros = sessions.filter(s => s.type === 'pomodoro' && inWeek(s));
  const problems  = sessions.filter(s => s.type === 'problem'  && inWeek(s));

  const bySubject = {};
  pomodoros.forEach(s => {
    const key = s.subject || 'No subject';
    if (!bySubject[key]) bySubject[key] = { hours: 0, exercises: 0 };
    bySubject[key].hours += (s.pomodoroTime || 0) / 3600;
  });
  problems.forEach(p => {
    const key = p.subject || 'No subject';
    if (!bySubject[key]) bySubject[key] = { hours: 0, exercises: 0 };
    bySubject[key].exercises += 1;
  });

  const totalHours = Object.values(bySubject).reduce((a, d) => a + d.hours, 0);
  const totalExercises = Object.values(bySubject).reduce((a, d) => a + d.exercises, 0);

  let html = `<p>Week from ${startStr} to ${endStr}</p>`;
  html += `<table style="width:100%;">
    <tr><th>Subject</th><th>Hours</th><th>Exercises</th></tr>
    ${Object.entries(bySubject).map(([subject, data]) => `
      <tr>
        <td>${escapeHtml(subject)}</td>
        <td>${data.hours.toFixed(2)} h</td>
        <td>${data.exercises}</td>
      </tr>
    `).join('')}
    <tr style="font-weight:bold;">
      <td>Total</td>
      <td>${totalHours.toFixed(2)} h</td>
      <td>${totalExercises}</td>
    </tr>
  </table>`;

  container.innerHTML = html;
}

// ===================== PUBLIC API =====================
export async function refreshComparison() {
  await populateComparisonSubjects();

  // ---- Defaults ----
  // When the user first lands on the Comparison panel (or after a reload),
  // prefill the date and week inputs so they don't stare at empty fields.
  const dateInput = document.getElementById('comparisonDate');
  const weekInput = document.getElementById('comparisonWeek');
  if (dateInput && !dateInput.value) dateInput.value = todayLocal();
  if (weekInput && !weekInput.value) weekInput.value = getCurrentISOWeek();

  const dataset = await loadDataset();
  await renderToday(dataset);
  await renderSelectedDay(dataset);
  await renderWeek(dataset);
}

// ===================== THEME REACTIVITY =====================
// Re-render the bar chart if the theme changes.
window.addEventListener('sq-theme-changed', async () => {
  const dateInput = document.getElementById('comparisonDate');
  if (!dateInput || !dateInput.value) return;
  const dataset = await loadDataset();
  const filter = document.getElementById('comparisonSubject').value;
  await renderComparisonChart(dataset, dateInput.value, filter);
}); 