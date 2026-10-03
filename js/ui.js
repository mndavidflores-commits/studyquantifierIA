import { state, PomodoroState } from './config.js';
import { formatTime } from './utils.js';

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

export function updatePomodoroStatusText() {
  const el = document.getElementById('pomoStatus');
  if (el) {
    switch (state.session.state) {
      case PomodoroState.FOCUS_RUNNING:   el.textContent = 'Focus'; break;
      case PomodoroState.FOCUS_PAUSED:    el.textContent = 'Focus (paused)'; break;
      case PomodoroState.BREAK_RUNNING:   el.textContent = 'Break'; break;
      case PomodoroState.BREAK_PAUSED:    el.textContent = 'Break (paused)'; break;
      case PomodoroState.SESSION_ENDING:  el.textContent = 'Stopped'; break;
      default:                            el.textContent = 'Focus';
    }
  }
  const circle = document.getElementById('pomoCircle');
  if (circle) circle.classList.toggle('break', state.session.state.startsWith('BREAK'));
}

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

  // Floating buttons
  const floatPause = document.getElementById('btnPomoPauseFloat');
  if (floatPause) {
    floatPause.style.display = sessionActive ? '' : 'none';
    if (sessionActive) {
      floatPause.textContent = (st === PomodoroState.FOCUS_RUNNING || st === PomodoroState.BREAK_RUNNING) ? '⏯' : '▶';
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

    // Update float button: icon + accumulated time, without destroying the elements
    const iconFloat = document.getElementById('readingIconFloat');
    if (iconFloat) iconFloat.textContent = '▶';
    const totalFloat = document.getElementById('readingTotalFloat');
    if (totalFloat) totalFloat.textContent = display;
  }
}

// ===================== BLIND TIMER =====================
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

export function updateBlindDisplay() {
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = formatTime(state.blindTimer.seconds);
}