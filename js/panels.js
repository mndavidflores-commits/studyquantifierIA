import { refreshHistory } from './history.js';
import { refreshMetrics, refreshMetricsPanel } from './metrics.js';
import { refreshSleepHistory, refreshSleepChart, refreshNotes } from './sleepNotes.js';
import { refreshChecklist, refreshGoals } from './checklistGoals.js';
import { refreshConjecturesFull } from './conjectures.js';
import { refreshSessionConjectures } from './reviews.js';
import { refreshComparison } from './comparison.js';

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
      break;
    case 'panelComparison':
      refreshComparison();
      break;
    case 'panelSleep':
      refreshSleepHistory();
      refreshSleepChart();
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