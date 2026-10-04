import { db, state } from './config.js';
import { formatDate } from './utils.js';

// Chart instances (module-local, one per chart)
let problemsChart = null;
let fsrsChart = null;
let sleepChart = null;

export function getThemeColors() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    isLight,
    ink: isLight ? '#FFF8F0' : '#1E1E24',
    inkSoft: isLight ? '#F2EAE0' : '#26262D',
    inkBorder: isLight ? 'rgba(30, 30, 36, 0.10)' : 'rgba(255, 248, 240, 0.08)',
    paper: isLight ? '#1E1E24' : '#FFF8F0',
    paperSoft: isLight ? 'rgba(30, 30, 36, 0.75)' : 'rgba(255, 248, 240, 0.70)',
    paperMute: isLight ? 'rgba(30, 30, 36, 0.50)' : 'rgba(255, 248, 240, 0.45)',
    accent: '#92140C',
    accentSoft: isLight ? 'rgba(146, 20, 12, 0.10)' : 'rgba(146, 20, 12, 0.12)',
    accentHover: '#B01A10'
  };
}

// ===================== PROBLEMS SCATTER CHART =====================
export async function renderProblemsChart() {
  const ctx = document.getElementById('chartProblems')?.getContext('2d');
  if (!ctx) return;

  const th = getThemeColors();
  const problems = await db.sessions.where('type').equals('problem').toArray();
  const filtered = problems.filter(p => p.subject === state.selectedChartSubject);
  filtered.sort((a, b) =>
    new Date(a.timestamp || a.date) - new Date(b.timestamp || b.date)
  );

  const pointsA = filtered.filter(p => p.mode === 'A');
  const pointsB = filtered.filter(p => p.mode === 'B');

  function colorForResult(result) {
    if (result === 'correct') return th.accent;
    return th.paperMute;
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
      pointBorderColor: th.inkSoft,
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
      pointBorderWidth: 2,
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
      borderColor: th.accent,
      backgroundColor: 'transparent',
      borderWidth: 2,
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
            backgroundColor: th.inkSoft,
            titleColor: th.paper,
            bodyColor: th.paperSoft,
            borderColor: th.accent,
            borderWidth: 1,
            cornerRadius: 4,
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
            title: { display: true, text: 'Problem # (sequential)', color: th.paperMute, font: { family: 'Inter', size: 11, weight: '600' } },
            ticks: {
              color: th.paperMute,
              stepSize: 1,
              font: { family: 'JetBrains Mono', size: 10 },
              callback: function (value) { return Number.isInteger(value) ? value : ''; }
            },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
          },
          y: {
            title: { display: true, text: 'Minutes', color: th.paperMute, font: { family: 'Inter', size: 11, weight: '600' } },
            beginAtZero: true,
            grace: '5%',
            ticks: { color: th.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
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

  const th = getThemeColors();
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
            borderColor: th.accent,
            backgroundColor: th.accentSoft,
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3
          },
          {
            label: 'Average difficulty',
            data: avgDifficulty,
            borderColor: th.paperMute,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 3,
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
            backgroundColor: th.inkSoft,
            titleColor: th.paper,
            bodyColor: th.paperSoft,
            borderColor: th.accent,
            borderWidth: 1,
            cornerRadius: 4,
            padding: 10
          },
          legend: {
            display: true,
            labels: { color: th.paper, font: { family: 'Inter', size: 12, weight: '500' } }
          }
        },
        scales: {
          x: {
            ticks: { color: th.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
          },
          y: {
            ticks: { color: th.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
          }
        }
      }
    });
  }
}

// ===================== ACTIVITY HEATMAP =====================
export async function renderHeatmap(sessions) {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;

  const today = new Date();
  const start = new Date();
  start.setMonth(today.getMonth() - 11);
  start.setDate(1);

  const hoursByDay = new Map();
  sessions.filter(s => s.type === 'pomodoro').forEach(s => {
    const date = s.date || formatDate(s.timestamp);
    const hours = (s.pomodoroTime || 0) / 3600;
    hoursByDay.set(date, (hoursByDay.get(date) || 0) + hours);
  });

  const fragment = document.createDocumentFragment();
  const cursor = new Date(start);

  while (cursor <= today) {
    const dateStr = formatDate(cursor);
    const hours = hoursByDay.get(dateStr) || 0;
    const level = hours === 0 ? 0 : (hours <= 1 ? 1 : (hours <= 2 ? 2 : (hours <= 4 ? 3 : 4)));

    const cell = document.createElement('div');
    cell.className = 'heatmap-day';
    cell.dataset.level = level;
    cell.title = `${dateStr}: ${hours.toFixed(1)}h`;
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

  const th = getThemeColors();
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
            borderColor: th.accent,
            backgroundColor: 'transparent',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: 'Bedtime',
            data: bedtimeMinutes,
            borderColor: th.paperMute,
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 3
          },
          {
            label: 'Wake up',
            data: wakeupMinutes,
            borderColor: th.paperSoft,
            backgroundColor: 'transparent',
            yAxisID: 'y1',
            tension: 0.3,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            ticks: { color: th.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            max: 10,
            title: { display: true, text: 'Quality (0-10)', color: th.paperMute, font: { family: 'Inter', size: 11, weight: '600' } },
            ticks: { color: th.paperMute, font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: th.inkBorder, borderDash: [2, 2] },
            border: { display: false }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: 1440,
            title: { display: true, text: 'Time of day', color: th.paperMute, font: { family: 'Inter', size: 11, weight: '600' } },
            ticks: {
              color: th.paperMute,
              font: { family: 'JetBrains Mono', size: 10 },
              stepSize: 120,
              callback: function (value) {
                const h24 = Math.floor(value / 60);
                const m = value % 60;
                const ampm = h24 >= 12 ? 'PM' : 'AM';
                let h12 = h24 % 12;
                if (h12 === 0) h12 = 12;
                return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
              }
            },
            grid: { drawOnChartArea: false },
            border: { display: false }
          }
        },
        plugins: {
          tooltip: {
            backgroundColor: th.inkSoft,
            titleColor: th.paper,
            bodyColor: th.paperSoft,
            borderColor: th.accent,
            borderWidth: 1,
            cornerRadius: 4,
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
          },
          legend: {
            labels: { color: th.paper, font: { family: 'Inter', size: 12, weight: '500' } }
          }
        }
      }
    });
  }
}

// ===================== RECOLOR ALL CHARTS =====================
export async function recolorCharts() {
  if (problemsChart) {
    problemsChart.destroy();
    problemsChart = null;
    await renderProblemsChart();
  }
  if (fsrsChart) {
    fsrsChart.destroy();
    fsrsChart = null;
    await renderFSRSChart();
  }
  if (sleepChart) {
    sleepChart.destroy();
    sleepChart = null;
    await refreshSleepChart();
  }
  try {
    const { recolorComparisonChart } = await import('./comparison.js');
    if (recolorComparisonChart) recolorComparisonChart();
  } catch (_) {}
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