import { refreshHistory } from './history.js';
import { refreshMetrics, refreshMetricsPanel } from './metrics.js';
import { refreshSleepHistory, refreshSleepChart, refreshNotes } from './sleepNotes.js';
import { refreshChecklist, refreshGoals } from './checklistGoals.js';
import { refreshConjecturesFull } from './conjectures.js';
import { refreshSessionConjectures } from './reviews.js';
import { refreshComparison, resizeComparisonChart } from './comparison.js';
import { resizeChartsSoon } from './charts.js';

// ===================== REFRESH ALL PANELS =====================
export function refreshAll() {
  // Fire-and-forget: each refresh is independent.
  refreshHistory();
  refreshMetrics();
  refreshSleepHistory();
  refreshSleepChart();
  refreshSessionConjectures();
  refreshConjecturesFull();
  refreshChecklist();
  refreshGoals();
  refreshMetricsPanel();
  refreshNotes();
  refreshComparison();

  // Charts created while the panel was hidden may end up at 0×0 — resize on
  // the next frame so they pick up the correct container dimensions.
  resizeChartsSoon();
  resizeComparisonChart();
}

// ===================== REFRESH ACTIVE PANEL ONLY =====================
export function refreshActivePanels() {
  const activePanel = document.querySelector('.panel.active')?.id;
  if (!activePanel) return;

  switch (activePanel) {
    case 'panelSession':
      // Session panel is driven by the pomodoro/timer state machine.
      // Nothing to refresh from here.
      break;
    case 'panelHistory':
      refreshHistory();
      break;
    case 'panelMetrics':
      refreshMetrics();
      refreshMetricsPanel();
      // Panel was likely hidden when the chart was first created — force resize.
      resizeChartsSoon();
      break;
    case 'panelComparison':
      refreshComparison();
      resizeComparisonChart();
      break;
    case 'panelSleep':
      refreshSleepHistory();
      refreshSleepChart();
      // Sleep chart has the same "created while hidden" issue.
      resizeChartsSoon();
      break;
    case 'panelConjectures':
      refreshConjecturesFull();
      break;
    case 'panelNotes':
      refreshNotes();
      break;
    case 'panelChecklist':
      refreshChecklist();
      break;
    case 'panelGoals':
      refreshGoals();
      break;
    default:
      break;
  }
}