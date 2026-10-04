import { db, state } from './config.js';
import { todayLocal, formatDate, formatHMS, escapeHtml } from './utils.js';

let comparisonChart = null;

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
          backgroundColor: '#ca4754',
          hoverBackgroundColor: '#e06c78',
          borderColor: '#ca4754',
          borderWidth: 1,
          borderRadius: 2
        },
        {
          label: 'Exercises',
          data: exercises,
          backgroundColor: '#3dd6c8',
          hoverBackgroundColor: '#5fe0d4',
          borderColor: '#3dd6c8',
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
          backgroundColor: '#2c2e31',
          titleColor: '#d1d0c5',
          bodyColor: '#d1d0c5',
          borderColor: '#646669',
          borderWidth: 1
        },
        legend: {
          display: true,
          labels: { color: '#d1d0c5' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#646669' },
          grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
        },
        y: {
          ticks: { color: '#646669' },
          grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
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