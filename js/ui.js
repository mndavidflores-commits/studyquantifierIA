import { state, PomodoroState } from './config.js';
import { formatTime, showToast } from './utils.js';

// ===================== ICON HELPER (Lucide) =====================
/**
 * Replaces the icon inside a button with a new Lucide icon and re-hydrates it.
 * Keeps the original `id` attribute on the <i> if it exists, so other code
 * that reads `#readingIconFloat` etc. keeps working.
 */
function setButtonIcon(buttonId, iconName) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const oldIcon = btn.querySelector('i, svg');
  if (!oldIcon) return;

  const newIcon = document.createElement('i');
  newIcon.setAttribute('data-lucide', iconName);
  newIcon.setAttribute('aria-hidden', 'true');
  if (oldIcon.id) newIcon.id = oldIcon.id;

  oldIcon.replaceWith(newIcon);
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// ===================== CONFIG CONTROLS =====================
/**
 * Enables or disables the session configuration selectors.
 * When a session is running, all selectors are locked.
 */
export function setConfigEnabled(enabled) {
  const ids = ['selPhase', 'selMode', 'selSubject', 'selSubtopic', 'selBook', 'selChapter', 'selSection'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// ===================== POMODORO DISPLAY =====================
export function updatePomodoroDisplay() {
  let time;
  if (state.session.pomodoroMode === 'timer') {
    const m = Math.floor(state.session.elapsedTotal / 60);
    const s = state.session.elapsedTotal % 60;
    time = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else {
    const m = Math.floor(state.session.remainingSeconds / 60);
    const s = state.session.remainingSeconds % 60;
    time = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const circle = document.getElementById('pomoCircle');
  if (circle) circle.textContent = time;
  const floatTime = document.getElementById('pomoFloatTime');
  if (floatTime) floatTime.textContent = time;
}

export function updatePomodoroModeButton() {
  const btn = document.getElementById('btnTogglePomodoroMode');
  const timeInputs = document.getElementById('pomoTimeInputs');
  if (!btn) return;

  if (state.session.pomodoroMode === 'countdown') {
    btn.textContent = 'Mode: Countdown';
    btn.classList.remove('active');
    if (timeInputs) timeInputs.style.display = 'grid';
  } else {
    btn.textContent = 'Mode: Free timer';
    btn.classList.add('active');
    if (timeInputs) timeInputs.style.display = 'none';
  }
  updatePomodoroDisplay();
}

// ===================== POMODORO STATUS TEXT =====================
// Centralized map so the state → label relationship is easy to update.
const POMO_STATUS_TEXT = {
  [PomodoroState.IDLE]:           'Ready',
  [PomodoroState.FOCUS_RUNNING]:  'Focus',
  [PomodoroState.FOCUS_PAUSED]:   'Focus paused',
  [PomodoroState.BREAK_RUNNING]:  'Break',
  [PomodoroState.BREAK_PAUSED]:   'Break paused',
  [PomodoroState.SESSION_ENDING]: 'Stopped'
};

export function updatePomodoroStatusText() {
  const el = document.getElementById('pomoStatus');
  if (el) {
    el.textContent = POMO_STATUS_TEXT[state.session.state] || 'Ready';
  }

  // The circle border turns muted during break states (visual cue).
  const circle = document.getElementById('pomoCircle');
  if (circle) {
    const isBreak = state.session.state === PomodoroState.BREAK_RUNNING
                 || state.session.state === PomodoroState.BREAK_PAUSED;
    circle.classList.toggle('break', isBreak);
  }
}

// ===================== POMODORO BUTTONS =====================
export function updatePomodoroButtons() {
  const st = state.session.state;
  const setDisplay = (id, visible, displayValue = 'inline-flex') => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? displayValue : 'none';
  };

  setDisplay('btnPomoStart', st === PomodoroState.IDLE);
  setDisplay('btnPomoPause', st === PomodoroState.FOCUS_RUNNING || st === PomodoroState.BREAK_RUNNING);
  setDisplay('btnPomoResume', st === PomodoroState.FOCUS_PAUSED || st === PomodoroState.BREAK_PAUSED);

  const sessionActive = st !== PomodoroState.IDLE && st !== PomodoroState.SESSION_ENDING;
  setDisplay('btnPomoStop', sessionActive);
  setDisplay('btnPomoReset', sessionActive);

  // Floating pause/play button — swap icon based on current state.
  const floatPause = document.getElementById('btnPomoPauseFloat');
  if (floatPause) {
    floatPause.style.display = sessionActive ? '' : 'none';
    if (sessionActive) {
      const running = (st === PomodoroState.FOCUS_RUNNING || st === PomodoroState.BREAK_RUNNING);
      setButtonIcon('btnPomoPauseFloat', running ? 'pause' : 'play');
    }
  }

  setDisplay('btnPomoStopFloat', sessionActive, '');
  setDisplay('btnPomoResetFloat', sessionActive, '');
}

// ===================== INTERVAL CONTROL =====================
export function stopPomodoroInterval() {
  if (state.session.pomoInterval) {
    clearInterval(state.session.pomoInterval);
    state.session.pomoInterval = null;
  }
}

export function stopReadingInterval() {
  if (state.session.readingInterval) {
    clearInterval(state.session.readingInterval);
    state.session.readingInterval = null;
  }
  if (state.session.readingRunning) {
    state.session.readingRunning = false;
    const m = Math.floor(state.session.readingSeconds / 60);
    const s = state.session.readingSeconds % 60;
    const display = `${m}:${String(s).padStart(2, '0')}`;

    const total = document.getElementById('readingTotal');
    if (total) total.textContent = display;

    // Both reading blocks (in #pomo-float and #reading-float) reset their icon.
    setButtonIcon('btnReadingToggleFloat', 'play');
    setButtonIcon('btnReadingToggleFloatB', 'play');

    const totalFloat = document.getElementById('readingTotalFloat');
    if (totalFloat) totalFloat.textContent = display;
    const totalFloatB = document.getElementById('readingTotalFloatB');
    if (totalFloatB) totalFloatB.textContent = display;
  }
}

// ===================== BLIND TIMER =====================
// These functions used to live in `timer.js`. They moved here so that
// `pomodoro.js` can call `stopBlindTimerAndShowResult` without importing
// from `timer.js` — which used to create a circular dependency between
// `timer.js` ⇄ `pomodoro.js` ⇄ `reviews.js`.

export function updateBlindDisplay() {
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = formatTime(state.blindTimer.seconds);
}

/**
 * Starts the blind (problem) timer. Only valid while a pomodoro phase is
 * actually running. In Mode B, requires a pending mistake to be selected.
 */
export function startBlindTimer() {
  if (state.blindTimer.running || state.blindTimer.pendingResult) return;
  if (state.session.state !== PomodoroState.FOCUS_RUNNING && state.session.state !== PomodoroState.BREAK_RUNNING) return;
  if (state.session.mode === 'B' && !state.selectedMistake) {
    showToast('Select a pending mistake first.');
    return;
  }

  state.blindTimer.running = true;
  state.blindTimer.pendingResult = false;
  state.blindTimer.paused = false;
  state.blindTimer.wasRunning = false;

  const label = document.getElementById('timerLabel');
  if (label) label.textContent = 'Studying...';

  state.blindTimer.startTime = Date.now() - state.blindTimer.seconds * 1000;

  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.add('timer-running');

  state.blindTimer.interval = setInterval(() => {
    state.blindTimer.seconds = (Date.now() - state.blindTimer.startTime) / 1000;
    updateBlindDisplay();
  }, 100);
}

/**
 * Freezes the blind timer and reveals the result card.
 * The accumulated seconds are preserved so the caller can save them.
 */
export function stopBlindTimerAndShowResult() {
  if (!state.blindTimer.running) return;
  state.blindTimer.running = false;
  clearInterval(state.blindTimer.interval);
  state.blindTimer.interval = null;

  const label = document.getElementById('timerLabel');
  if (label) label.textContent = 'Stopped';
  updateBlindDisplay();

  const shown = document.getElementById('timeShown');
  if (shown) {
    shown.textContent = `${formatTime(state.blindTimer.seconds)} (${(state.blindTimer.seconds / 60).toFixed(2)} min)`;
  }

  if (state.session.mode !== 'B') {
    state.blindTimer.previousProblemNumber = parseInt(document.getElementById('numProblem').value, 10) || 1;
  }

  const cardResult = document.getElementById('cardResult');
  if (cardResult) cardResult.style.display = 'block';
  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.remove('timer-running');
  const timerDisplay = document.getElementById('timerDisplay');
  if (timerDisplay) timerDisplay.style.display = 'block';
  const conjInline = document.getElementById('conjecture-inline');
  if (conjInline) conjInline.classList.remove('hidden');
  const leftPanel = document.getElementById('left-panel');
  if (leftPanel) leftPanel.classList.remove('hidden');

  state.blindTimer.pendingResult = true;
}

/**
 * Stops the blind (problem) timer if it's running, and clears the pending
 * result state. Does NOT reset `state.blindTimer.seconds` — that's handled
 * by the pomodoro transition when a full reset is required (IDLE / SESSION_ENDING).
 */
export function stopBlindTimer() {
  if (state.blindTimer.running) {
    state.blindTimer.running = false;
    clearInterval(state.blindTimer.interval);
    state.blindTimer.interval = null;
  }
  state.blindTimer.pendingResult = false;
  const card = document.getElementById('cardResult');
  if (card) card.style.display = 'none';
  const label = document.getElementById('timerLabel');
  if (label) label.textContent = 'Paused';
  updateBlindDisplay();
  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.remove('timer-running');
}