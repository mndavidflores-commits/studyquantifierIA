import { db, state } from './config.js';
import { formatDate } from './utils.js';

// Chart instances (module-local, one per chart)
let problemsChart = null;
let fsrsChart = null;
let sleepChart = null;

// ===================== RESIZE HOOK (used by panels.js) =====================
/**
 * Resizes all charts after the current frame has been painted.
 * Called when a panel becomes visible — Chart.js reads the container size
 * at construction time, so if the panel was hidden (display:none) when the
 * chart was first created, its canvas ends up at 0×0. Resizing after the
 * frame fixes that.
 */
export function resizeChartsSoon() {
  requestAnimationFrame(() => {
    if (problemsChart) problemsChart.resize();
    if (fsrsChart) fsrsChart.resize();
    if (sleepChart) sleepChart.resize();
  });
}

// ===================== PROBLEMS SCATTER CHART =====================
export async function renderProblemsChart() {
  const ctx = document.getElementById('chartProblems')?.getContext('2d');
  if (!ctx) return;

  const problems = await db.sessions.where('type').equals('problem').toArray();
  const filtered = problems.filter(p => p.subject === state.selectedChartSubject);
  filtered.sort((a, b) =>
    new Date(a.timestamp || a.date) - new Date(b.timestamp || b.date)
  );

  const pointsA = filtered.filter(p => p.mode === 'A');
  const pointsB = filtered.filter(p => p.mode === 'B');

  function colorForResult(result) {
    if (result === 'correct') return '#3dd6c8';
    if (result === 'incorrect') return '#fa5c7c';
    if (result === 'unresolved') return '#5c7cfa';
    return '#ffffff';
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
      pointBorderColor: '#323437',
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
      borderColor: '#ca4754',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.35
    });
  }

  if (problemsChart) {
    problemsChart.data.datasets = datasets;
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
            backgroundColor: '#2c2e31',
            titleColor: '#d1d0c5',
            bodyColor: '#d1d0c5',
            borderColor: '#646669',
            borderWidth: 1,
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
            title: { display: true, text: 'Problem # (sequential)', color: '#646669' },
            ticks: {
              color: '#646669',
              stepSize: 1,
              callback: function (value) { return Number.isInteger(value) ? value : ''; }
            },
            grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
          },
          y: {
            title: { display: true, text: 'Minutes', color: '#646669' },
            beginAtZero: true,
            grace: '5%',
            ticks: { color: '#646669' },
            grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
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
            borderColor: '#ca4754',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3
          },
          {
            label: 'Average difficulty',
            data: avgDifficulty,
            borderColor: '#646669',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 4,
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
            backgroundColor: '#2c2e31',
            titleColor: '#d1d0c5',
            bodyColor: '#d1d0c5',
            borderColor: '#646669',
            borderWidth: 1
          },
          legend: {
            display: true,
            labels: { color: '#d1d0c5', font: { family: 'Roboto Mono' } }
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
}

// ===================== ACTIVITY HEATMAP =====================
/**
 * Renders a 12-month activity heatmap.
 *
 * The container is a CSS grid with `grid-auto-flow: column` and
 * `grid-template-rows: repeat(7, 12px)`, so every column = one week and
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

  // Start: 1st of the month, 11 months ago, aligned to the previous Sunday.
  const start = new Date(today);
  start.setMonth(today.getMonth() - 11);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());

  // End: Saturday of the current week (so the last column is complete).
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  // Aggregate hours by day from pomodoro sessions.
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
      // Future days: keep the cell in the grid but mark it invisible.
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
            borderColor: '#ca4754',
            backgroundColor: 'transparent',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 4
          },
          {
            label: 'Bedtime',
            data: bedtimeMinutes,
            borderColor: '#646669',
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 4
          },
          {
            label: 'Wake up',
            data: wakeupMinutes,
            borderColor: '#3dd6c8',
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            max: 10,
            title: { display: true, text: 'Quality (0-10)', color: '#646669' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1440,
            title: { display: true, text: 'Minutes since midnight', color: '#646669' },
            ticks: {
              stepSize: 60,
              callback: function (value) {
                const h24 = Math.floor(value / 60);
                const m = value % 60;
                const ampm = h24 >= 12 ? 'PM' : 'AM';
                let h12 = h24 % 12;
                if (h12 === 0) h12 = 12;
                return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
              }
            }
          }
        },
        plugins: {
          tooltip: {
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