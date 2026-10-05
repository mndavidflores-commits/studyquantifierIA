import { db, state } from './config.js';
import { formatDate } from './utils.js';

// Chart instances (module-local, one per chart)
let problemsChart = null;
let fsrsChart = null;
let sleepChart = null;

// ===================== COLOR HELPERS =====================
/**
 * Reads the design system colors from CSS custom properties so charts
 * follow the active theme. Called at the start of every render.
 *
 * Palette (dark mode only):
 *   accent  → #92140C  oxblood      (primary / incorrect)
 *   ok      → #6E9075  dusty olive  (correct)
 *   pending → #6D72C3  slate blue   (unresolved / neutral)
 *   paper   → #FFF8F0  floral white (text / strokes)
 *   ink     → #1E1E24  shadow grey  (backgrounds)
 */
function getChartColors() {
  const root = getComputedStyle(document.documentElement);
  const get = (v) => root.getPropertyValue(v).trim();

  return {
    accent:       get('--accent')       || '#92140C',
    accentSoft:   get('--accent-soft')  || 'rgba(146,20,12,0.12)',
    accentHover:  get('--accent-hover') || '#B01A10',

    ok:           get('--ok')           || '#6E9075',
    okSoft:       get('--ok-soft')      || 'rgba(110,144,117,0.15)',
    okHover:      get('--ok-hover')     || '#7FA288',

    pending:      get('--pending')      || '#6D72C3',
    pendingSoft:  get('--pending-soft') || 'rgba(109,114,195,0.15)',
    pendingHover: get('--pending-hover')|| '#8085D0',

    paper:        get('--paper')        || '#FFF8F0',
    paperSoft:    get('--paper-soft')   || 'rgba(255,248,240,0.7)',
    paperMute:    get('--paper-mute')   || 'rgba(255,248,240,0.45)',

    ink:          get('--ink')          || '#1E1E24',
    inkSoft:      get('--ink-soft')     || '#26262D',
    inkBorder:    get('--ink-border')   || 'rgba(255,248,240,0.08)'
  };
}

// ===================== RESIZE HOOK (used by panels.js) =====================
export function resizeChartsSoon() {
  requestAnimationFrame(() => {
    if (problemsChart) problemsChart.resize();
    if (fsrsChart) fsrsChart.resize();
    if (sleepChart) sleepChart.resize();
  });
}

// ===================== THEME REACTIVITY =====================
// events.js dispatches 'sq-theme-changed' when the user toggles the theme.
// Re-render all charts so they pick up the new CSS variable values.
window.addEventListener('sq-theme-changed', () => {
  renderProblemsChart().catch(() => {});
  renderFSRSChart().catch(() => {});
  refreshSleepChart().catch(() => {});
});

// ===================== PROBLEMS SCATTER CHART =====================
export async function renderProblemsChart() {
  const ctx = document.getElementById('chartProblems')?.getContext('2d');
  if (!ctx) return;

  const C = getChartColors();

  const problems = await db.sessions.where('type').equals('problem').toArray();
  const filtered = problems.filter(p => p.subject === state.selectedChartSubject);
  filtered.sort((a, b) =>
    new Date(a.timestamp || a.date) - new Date(b.timestamp || b.date)
  );

  const pointsA = filtered.filter(p => p.mode === 'A');
  const pointsB = filtered.filter(p => p.mode === 'B');

  // Result colors — semantic mapping to the new palette.
  //   correct    → dusty olive
  //   incorrect  → oxblood
  //   unresolved → slate blue
  function colorForResult(result) {
    if (result === 'correct')    return C.ok;
    if (result === 'incorrect')  return C.accent;
    if (result === 'unresolved') return C.pending;
    return C.paper;
  }

  const dataA = pointsA.map((p, index) => ({
    x: index + 1,
    y: (p.timeSeconds || 0) / 60,
    problem: p
  }));

  const dataB = pointsB.map((p, index) => ({
    x: index + 1,
    y: (p.timeSeconds || 0) / 60,
    problem: p
  }));

  const datasets = [];

  if (state.showPointsA) {
    datasets.push({
      label: 'Session A',
      data: dataA,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointBackgroundColor: dataA.map(d => colorForResult(d.problem.result)),
      pointBorderColor: C.ink,
      pointBorderWidth: 1.5,
      showLine: false,
      type: 'scatter'
    });
  }

  if (state.showPointsB) {
    datasets.push({
      label: 'Session B',
      data: dataB,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointBackgroundColor: 'transparent',
      pointBorderColor: dataB.map(d => colorForResult(d.problem.result)),
      pointBorderWidth: 2.5,
      showLine: false,
      type: 'scatter'
    });
  }

  // Rolling average over the last 10 problems
  const averages = [];
  if (filtered.length > 0) {
    for (let i = 0; i < filtered.length; i++) {
      const start = Math.max(0, i - 9);
      const window = filtered.slice(start, i + 1);
      const totalMinutes = window.reduce((acc, p) => acc + (p.timeSeconds || 0) / 60, 0);
      averages.push({ x: i + 1, y: totalMinutes / window.length });
    }
  }

  if (state.showAvg10 && averages.length > 0) {
    datasets.push({
      label: 'Avg 10',
      data: averages,
      type: 'line',
      borderColor: C.paperSoft,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.35
    });
  }

  if (problemsChart) {
    problemsChart.data.datasets = datasets;
    problemsChart.options.scales.x.title.color = C.paperMute;
    problemsChart.options.scales.y.title.color = C.paperMute;
    problemsChart.options.scales.x.ticks.color = C.paperMute;
    problemsChart.options.scales.y.ticks.color = C.paperMute;
    problemsChart.options.scales.x.grid.color = C.inkBorder;
    problemsChart.options.scales.y.grid.color = C.inkBorder;
    problemsChart.options.plugins.tooltip.backgroundColor = C.inkSoft;
    problemsChart.options.plugins.tooltip.borderColor = C.inkBorder;
    problemsChart.options.plugins.tooltip.titleColor = C.paper;
    problemsChart.options.plugins.tooltip.bodyColor = C.paperSoft;
    problemsChart.update();
  } else {
    problemsChart = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
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
            padding: 10,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const p = items[0].raw?.problem;
                return p ? `Problem #${p.problemNumber || '?'}` : '';
              },
              label: (context) => {
                const p = context.raw?.problem;
                if (!p) {
                  return context.dataset.label === 'Avg 10'
                    ? `Average: ${context.parsed.y.toFixed(1)} min`
                    : `Time: ${context.parsed.y.toFixed(1)} min`;
                }
                const lines = [
                  `Time: ${((p.timeSeconds || 0) / 60).toFixed(1)} min`,
                  `Result: ${p.result}`
                ];
                if (p.confidence) lines.push(`Confidence: ${p.confidence}`);
                if (p.errorCode) lines.push(`Error: ${p.errorCode}`);
                return lines;
              }
            }
          },
          legend: { display: false }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Problem # (sequential)', color: C.paperMute },
            ticks: {
              color: C.paperMute,
              stepSize: 1,
              callback: function (value) { return Number.isInteger(value) ? value : ''; }
            },
            grid: { color: C.inkBorder, borderDash: [2, 2], drawBorder: false }
          },
          y: {
            title: { display: true, text: 'Minutes', color: C.paperMute },
            beginAtZero: true,
            grace: '5%',
            ticks: { color: C.paperMute },
            grid: { color: C.inkBorder, borderDash: [2, 2], drawBorder: false }
          }
        }
      }
    });
  }
}

// ===================== FSRS MEMORY CHART =====================
export async function renderFSRSChart() {
  const ctx = document.getElementById('chartFSRS')?.getContext('2d');
  if (!ctx) return;

  const C = getChartColors();
  const reviews = await db.reviews.orderBy('date').toArray();

  if (reviews.length === 0) {
    if (fsrsChart) {
      fsrsChart.destroy();
      fsrsChart = null;
    }
    return;
  }

  const byDay = {};
  reviews.forEach(r => {
    const day = r.date?.split('T')[0] || formatDate(r.date);
    if (!byDay[day]) byDay[day] = { stabilityTotal: 0, difficultyTotal: 0, count: 0 };
    byDay[day].stabilityTotal += (r.stability || 0);
    byDay[day].difficultyTotal += (r.difficulty || 0);
    byDay[day].count++;
  });

  const days = Object.keys(byDay).sort();
  const avgStability = days.map(d => byDay[d].stabilityTotal / byDay[d].count);
  const avgDifficulty = days.map(d => byDay[d].difficultyTotal / byDay[d].count);

  if (fsrsChart) {
    fsrsChart.data.labels = days;
    fsrsChart.data.datasets[0].data = avgStability;
    fsrsChart.data.datasets[1].data = avgDifficulty;
    fsrsChart.data.datasets[0].borderColor = C.accent;
    fsrsChart.data.datasets[0].backgroundColor = C.accentSoft;
    fsrsChart.data.datasets[0].pointBackgroundColor = C.accent;
    fsrsChart.data.datasets[1].borderColor = C.pending;
    fsrsChart.data.datasets[1].backgroundColor = 'transparent';
    fsrsChart.data.datasets[1].pointBackgroundColor = C.pending;
    fsrsChart.options.scales.x.ticks.color = C.paperMute;
    fsrsChart.options.scales.y.ticks.color = C.paperMute;
    fsrsChart.options.scales.x.grid.color = C.inkBorder;
    fsrsChart.options.scales.y.grid.color = C.inkBorder;
    fsrsChart.options.plugins.tooltip.backgroundColor = C.inkSoft;
    fsrsChart.options.plugins.tooltip.borderColor = C.inkBorder;
    fsrsChart.options.plugins.tooltip.titleColor = C.paper;
    fsrsChart.options.plugins.tooltip.bodyColor = C.paperSoft;
    fsrsChart.options.plugins.legend.labels.color = C.paperSoft;
    fsrsChart.update();
  } else {
    fsrsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: days,
        datasets: [
          {
            label: 'Average stability',
            data: avgStability,
            borderColor: C.accent,
            backgroundColor: C.accentSoft,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: C.accent,
            tension: 0.3
          },
          {
            label: 'Average difficulty',
            data: avgDifficulty,
            borderColor: C.pending,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: C.pending,
            tension: 0.3
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
              font: { family: 'Inter', size: 12 },
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true
            }
          }
        },
        scales: {
          x: {
            ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 11 } },
            grid: { color: C.inkBorder, drawBorder: false }
          },
          y: {
            ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 11 } },
            grid: { color: C.inkBorder, drawBorder: false }
          }
        }
      }
    });
  }
}

// ===================== ACTIVITY HEATMAP =====================
/**
 * Renders a 12-month activity heatmap.
 *
 * The container is a CSS grid with `grid-auto-flow: column` and
 * `grid-template-rows: repeat(7, 10px)`, so every column = one week and
 * every row = the same weekday. To keep that alignment:
 *   - `start` is the Sunday on or before the 1st of the month 11 months ago.
 *   - `end` is the Saturday on or after today.
 * Days after today are marked with `data-future="1"` and rendered empty.
 */
export async function renderHeatmap(sessions) {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setMonth(today.getMonth() - 11);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const hoursByDay = new Map();
  sessions.filter(s => s.type === 'pomodoro').forEach(s => {
    const date = s.date || formatDate(s.timestamp);
    const hours = (s.pomodoroTime || 0) / 3600;
    hoursByDay.set(date, (hoursByDay.get(date) || 0) + hours);
  });

  const fragment = document.createDocumentFragment();
  const cursor = new Date(start);

  while (cursor <= end) {
    const dateStr = formatDate(cursor);
    const hours = hoursByDay.get(dateStr) || 0;
    const level = hours === 0 ? 0 : (hours <= 1 ? 1 : (hours <= 2 ? 2 : (hours <= 4 ? 3 : 4)));

    const cell = document.createElement('div');
    cell.className = 'heatmap-day';

    if (cursor > today) {
      cell.dataset.future = '1';
      cell.title = `${dateStr} (future)`;
    } else {
      cell.dataset.level = level;
      cell.title = `${dateStr}: ${hours.toFixed(1)}h`;
    }

    fragment.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

// ===================== SLEEP CHART =====================
export async function refreshSleepChart() {
  const ctx = document.getElementById('chartSleep')?.getContext('2d');
  if (!ctx) return;

  const C = getChartColors();
  const records = await db.sleep.orderBy('date').toArray();

  if (records.length === 0) {
    if (sleepChart) {
      sleepChart.destroy();
      sleepChart = null;
    }
    return;
  }

  const labels = records.map(r => r.date);
  const qualityData = records.map(r => r.quality);
  const bedtimeMinutes = records.map(r => {
    if (!r.bedtime) return null;
    const [h, m] = r.bedtime.split(':').map(Number);
    return h * 60 + m;
  });
  const wakeupMinutes = records.map(r => {
    if (!r.wakeup) return null;
    const [h, m] = r.wakeup.split(':').map(Number);
    return h * 60 + m;
  });

  if (sleepChart) {
    sleepChart.data.labels = labels;
    sleepChart.data.datasets[0].data = qualityData;
    sleepChart.data.datasets[1].data = bedtimeMinutes;
    sleepChart.data.datasets[2].data = wakeupMinutes;
    sleepChart.data.datasets[0].borderColor = C.accent;
    sleepChart.data.datasets[0].pointBackgroundColor = C.accent;
    sleepChart.data.datasets[1].borderColor = C.pending;
    sleepChart.data.datasets[1].pointBackgroundColor = C.pending;
    sleepChart.data.datasets[2].borderColor = C.ok;
    sleepChart.data.datasets[2].pointBackgroundColor = C.ok;
    sleepChart.update();
  } else {
    sleepChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Quality (0-10)',
            data: qualityData,
            borderColor: C.accent,
            backgroundColor: 'transparent',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: C.accent,
            borderWidth: 2
          },
          {
            label: 'Bedtime',
            data: bedtimeMinutes,
            borderColor: C.pending,
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: C.pending,
            borderWidth: 2
          },
          {
            label: 'Wake up',
            data: wakeupMinutes,
            borderColor: C.ok,
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: C.ok,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: C.paperSoft,
              font: { family: 'Inter', size: 11 },
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: C.inkSoft,
            titleColor: C.paper,
            bodyColor: C.paperSoft,
            borderColor: C.inkBorder,
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.dataset.yAxisID === 'y1') {
                  const mins = context.parsed.y;
                  const h24 = Math.floor(mins / 60);
                  const m = mins % 60;
                  const ampm = h24 >= 12 ? 'PM' : 'AM';
                  let h12 = h24 % 12;
                  if (h12 === 0) h12 = 12;
                  label += `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                } else {
                  label += context.parsed.y;
                }
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            max: 10,
            title: { display: true, text: 'Quality', color: C.paperMute },
            ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 11 } },
            grid: { color: C.inkBorder, drawBorder: false }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1440,
            title: { display: true, text: 'Time', color: C.paperMute },
            ticks: {
              color: C.paperMute,
              font: { family: 'JetBrains Mono', size: 11 },
              stepSize: 360,
              callback: function (value) {
                const h24 = Math.floor(value / 60);
                const m = value % 60;
                let h12 = h24 % 12;
                if (h12 === 0) h12 = 12;
                return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}`;
              }
            },
            grid: { display: false, drawBorder: false }
          },
          x: {
            ticks: { color: C.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: C.inkBorder, drawBorder: false }
          }
        }
      }
    });
  }
}

// ===================== CHART CONTROLS (CLICK DELEGATION) =====================
document.addEventListener('click', (e) => {
  const filterBtn = e.target.closest('.chart-filter-btn');
  if (filterBtn) {
    document.querySelectorAll('.chart-filter-btn').forEach(b => b.classList.remove('active'));
    filterBtn.classList.add('active');
    state.selectedChartSubject = filterBtn.dataset.subject;
    renderProblemsChart();
    return;
  }

  const toggleAvg = e.target.closest('#toggleAvg10');
  if (toggleAvg) {
    state.showAvg10 = !state.showAvg10;
    toggleAvg.classList.toggle('active', state.showAvg10);
    renderProblemsChart();
    return;
  }

  const toggleA = e.target.closest('#toggleShowA');
  if (toggleA) {
    state.showPointsA = !state.showPointsA;
    toggleA.classList.toggle('active', state.showPointsA);
    renderProblemsChart();
    return;
  }

  const toggleB = e.target.closest('#toggleShowB');
  if (toggleB) {
    state.showPointsB = !state.showPointsB;
    toggleB.classList.toggle('active', state.showPointsB);
    renderProblemsChart();
  }
});