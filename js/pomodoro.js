import { db, state, PomodoroState } from './config.js';
import { formatTime, todayLocal, showToast } from './utils.js';
import { saveLocalAndOutbox, fixSessionId } from './sync.js';
import {
  setConfigEnabled,
  updatePomodoroDisplay,
  updatePomodoroStatusText,
  updatePomodoroButtons,
  stopPomodoroInterval,
  stopReadingInterval,
  stopBlindTimer,
  stopBlindTimerAndShowResult,
  updatePomodoroModeButton
} from './ui.js';
import { updateUIForMode, refreshSubtopicHistory } from './reviews.js';
import { verifyAddSubject, verifyAddSubtopic, verifyAddSection } from './selectors.js';

// NOTE: `stopBlindTimerAndShowResult` used to live in `timer.js`, which created
// a circular dependency (timer → reviews → pomodoro → timer). It now lives in
// `ui.js` alongside `stopBlindTimer` and `updateBlindDisplay`.

// ===================== TRANSITION (STATE MACHINE) =====================
export async function transition(newState) {
  const prev = state.session.state;
  if (prev === newState && newState !== PomodoroState.SESSION_ENDING) return;
  if (prev === PomodoroState.SESSION_ENDING && newState !== PomodoroState.IDLE) return;

  // ---------- IDLE ----------
  if (newState === PomodoroState.IDLE) {
    stopPomodoroInterval();
    stopReadingInterval();
    stopBlindTimer();

    state.session.pendingSessionEnd = false;
    state.session.tempId = null;
    state.session.distractions = 0;
    state.session.readingSeconds = 0;
    state.session.elapsedTotal = 0;
    state.session.totalFocusSeconds = 0;
    state.session.finalFocusSeconds = 0;
    state.session.savedSessionId = null;
    state.session.readingRunning = false;
    state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
    state.session.pomoStartTime = null;

    state.blindTimer.seconds = 0;
    state.blindTimer.running = false;
    state.blindTimer.pendingResult = false;
    state.blindTimer.previousProblemNumber = 1;
    state.blindTimer.wasRunning = false;
    state.blindTimer.paused = false;

    state.currentRecallGroup = null;
    state.selectedMistake = null;
    state.session.mode = null;

    updatePomodoroModeButton();
    updatePomodoroDisplay();
    document.getElementById('pomoCircle').classList.remove('break');
    setConfigEnabled(true);
    document.getElementById('pomoWork').disabled = false;
    document.getElementById('pomoBreak').disabled = false;
    document.getElementById('btnDistract').disabled = true;
    document.getElementById('btnReadingStart').disabled = true;
    document.getElementById('btnReadingStop').disabled = true;
    document.getElementById('readingTotal').textContent = '0:00';
    document.getElementById('topbar').classList.remove('hidden');

    if (!state.currentSession?.user) {
      document.getElementById('auth-section').classList.remove('hidden');
    } else {
      document.getElementById('auth-section').classList.add('hidden');
    }

    document.getElementById('idle-view').classList.remove('hidden');
    const activeView = document.getElementById('active-view');
    activeView.classList.remove('active');
    activeView.classList.remove('timer-running');
    document.getElementById('pomo-float').classList.add('hidden');
    document.getElementById('left-panel').classList.add('hidden');

    // Hide the "New subject / subtopic / section" rows — the user already
    // selected valid values in the dropdowns before starting the session.
    verifyAddSubject();
    verifyAddSubtopic();
    verifyAddSection();

    state.session.state = PomodoroState.IDLE;
    updatePomodoroStatusText();
    updatePomodoroButtons();
    return;
  }

  // ---------- FOCUS_RUNNING / BREAK_RUNNING ----------
  if (newState === PomodoroState.FOCUS_RUNNING || newState === PomodoroState.BREAK_RUNNING) {
    if (prev === PomodoroState.IDLE) {
      const ok = await setupNewSession();
      if (!ok) return;
    }

    if (newState === PomodoroState.BREAK_RUNNING) {
      const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 0;
      state.session.remainingSeconds = breakMinutes * 60;
      state.session.elapsedTotal = 0;
      state.session.pomoStartTime = Date.now();
    } else if (prev === PomodoroState.BREAK_RUNNING || prev === PomodoroState.BREAK_PAUSED) {
      state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
      state.session.elapsedTotal = 0;
      state.session.pomoStartTime = Date.now();
    } else if (prev === PomodoroState.FOCUS_PAUSED) {
      state.session.pomoStartTime = Date.now() - state.session.elapsedTotal * 1000;
    } else {
      state.session.pomoStartTime = Date.now() - state.session.elapsedTotal * 1000;
    }

    state.session.state = newState;
    stopPomodoroInterval();
    state.session.pomoInterval = setInterval(onPomodoroTick, 1000);

    if ((prev === PomodoroState.FOCUS_PAUSED || prev === PomodoroState.BREAK_PAUSED) && state.blindTimer.wasRunning) {
      state.blindTimer.wasRunning = false;
      state.blindTimer.paused = false;
      state.blindTimer.running = true;
      state.blindTimer.startTime = Date.now() - state.blindTimer.seconds * 1000;
      state.blindTimer.interval = setInterval(() => {
        state.blindTimer.seconds = (Date.now() - state.blindTimer.startTime) / 1000;
        const display = document.getElementById('timerDisplay');
        if (display) display.textContent = formatTime(state.blindTimer.seconds);
      }, 100);
    }

    updatePomodoroModeButton();
    updatePomodoroStatusText();
    updatePomodoroButtons();
    return;
  }

  // ---------- PAUSED ----------
  if (newState === PomodoroState.FOCUS_PAUSED || newState === PomodoroState.BREAK_PAUSED) {
    stopPomodoroInterval();
    stopReadingInterval();

    if (state.blindTimer.running) {
      state.blindTimer.running = false;
      state.blindTimer.wasRunning = true;
      state.blindTimer.paused = true;
      clearInterval(state.blindTimer.interval);
      state.blindTimer.interval = null;
    }

    state.session.state = newState;
    updatePomodoroStatusText();
    updatePomodoroButtons();
    return;
  }

  // ---------- SESSION_ENDING ----------
  if (newState === PomodoroState.SESSION_ENDING) {
    stopPomodoroInterval();
    stopReadingInterval();
    stopBlindTimer();

    state.blindTimer.seconds = 0;
    state.blindTimer.pendingResult = false;
    state.blindTimer.wasRunning = false;
    state.blindTimer.paused = false;

    state.session.finalFocusSeconds = state.session.totalFocusSeconds;

    document.getElementById('btnDistract').disabled = true;
    document.getElementById('btnReadingStart').disabled = true;
    document.getElementById('btnReadingStop').disabled = true;
    document.getElementById('pomoWork').disabled = false;
    document.getElementById('pomoBreak').disabled = false;
    setConfigEnabled(false);

    state.session.state = PomodoroState.SESSION_ENDING;
    updatePomodoroStatusText();
    updatePomodoroButtons();

    await autoSaveSession();
    await showSessionSummary();
    return;
  }
}

// ===================== NEW SESSION SETUP =====================
async function setupNewSession() {
  const subject = document.getElementById('selSubject').value;
  const mode = document.getElementById('selMode').value;
  const group = state.currentRecallGroup;

  let subtopic, book, section;
  if (mode === 'B' && group) {
    subtopic = group.subtopicId;
    book = group.book;
    section = group.section;
  } else {
    subtopic = document.getElementById('selSubtopic').value;
    book = document.getElementById('selBook').value;
    section = document.getElementById('selSection').value;
  }

  if (subject === '__add__' || (mode === 'B' && !group) || (mode !== 'B' && subtopic === '__add__')) {
    showToast('Select a valid subject and subtopic.');
    return false;
  }

  state.session.tempId = 'temp_' + Date.now();
  state.session.distractions = 0;
  state.session.readingSeconds = 0;
  state.session.totalFocusSeconds = 0;
  state.session.finalFocusSeconds = 0;
  state.session.savedSessionId = null;
  document.getElementById('readingTotal').textContent = '0:00';
  state.session.mode = mode;

  await updateUIForMode();

  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('auth-section').classList.add('hidden');

  const idleView = document.getElementById('idle-view');
  const activeView = document.getElementById('active-view');

  idleView.classList.add('fade-out');

  setTimeout(() => {
    idleView.classList.add('hidden');
    idleView.classList.remove('fade-out');
    activeView.classList.add('active');
    void activeView.offsetWidth;
    activeView.classList.add('fade-in');
  }, 400);

  document.getElementById('pomo-float').classList.remove('hidden');
  document.getElementById('left-panel').classList.remove('hidden');
  document.getElementById('nombreSubtopicHistory').textContent = (mode === 'B' && group)
    ? group.subtopicName
    : (document.getElementById('selSubtopic').selectedOptions[0]?.textContent || '');

  await refreshSubtopicHistory();
  setConfigEnabled(false);

  const previousProblems = await db.sessions
    .where('type').equals('problem')
    .and(p => p.subtopicId === subtopic && p.book === book)
    .toArray();
  const maxNumber = previousProblems.reduce((max, p) => Math.max(max, p.problemNumber || 0), 0);
  document.getElementById('numProblem').value = maxNumber + 1;
  state.currentProblemNumber = maxNumber + 1;

  document.getElementById('pomoWork').disabled = true;
  document.getElementById('pomoBreak').disabled = true;
  document.getElementById('btnDistract').disabled = false;
  document.getElementById('btnReadingStart').disabled = false;
  document.getElementById('btnReadingStop').disabled = false;

  return true;
}

// ===================== TICK =====================
function onPomodoroTick() {
  // Defensive guard: if this tick fires after a pause/stop transition (race
  // between setInterval and clearInterval), bail out before mutating state.
  if (state.session.state !== PomodoroState.FOCUS_RUNNING &&
      state.session.state !== PomodoroState.BREAK_RUNNING) {
    return;
  }

  const now = Date.now();
  const previousElapsed = state.session.elapsedTotal;
  const elapsedSeconds = Math.floor((now - state.session.pomoStartTime) / 1000);

  if (state.session.state === PomodoroState.FOCUS_RUNNING && elapsedSeconds > previousElapsed) {
    state.session.totalFocusSeconds += (elapsedSeconds - previousElapsed);
  }

  state.session.elapsedTotal = elapsedSeconds;

  if (state.session.pomodoroMode === 'countdown') {
    const totalWorkSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
    state.session.remainingSeconds = Math.max(0, totalWorkSeconds - elapsedSeconds);
  }

  updatePomodoroDisplay();

  if (state.session.pomodoroMode !== 'countdown') return;
  if (state.session.remainingSeconds > 0) return;

  stopPomodoroInterval();

  if (state.session.state === PomodoroState.FOCUS_RUNNING) {
    if (state.blindTimer.running) {
      state.session.pendingSessionEnd = true;
      stopBlindTimerAndShowResult();
    } else {
      enterBreakOrEnd();
    }
  } else if (state.session.state === PomodoroState.BREAK_RUNNING) {
    transition(PomodoroState.FOCUS_RUNNING);
  }
}

async function enterBreakOrEnd() {
  const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 0;
  if (breakMinutes > 0) {
    await transition(PomodoroState.BREAK_RUNNING);
  } else {
    await transition(PomodoroState.SESSION_ENDING);
  }
}

// ===================== AUTO-SAVE SESSION =====================
async function autoSaveSession() {
  if (!state.session.tempId) return null;
  if (state.session.savedSessionId) return state.session.savedSessionId;

  const problems = await db.sessions
    .where('type').equals('problem')
    .and(s => s.sessionId === state.session.tempId)
    .toArray();

  const total = problems.length;
  const totalTime = problems.reduce((a, p) => a + (p.timeSeconds || 0), 0);

  const conjectures = await db.conjectures
    .where('sessionId').equals(state.session.tempId)
    .toArray();

  const sessionId = await saveLocalAndOutbox('sessions', {
    type: 'pomodoro',
    date: todayLocal(),
    timestamp: Date.now(),
    mode: state.session.mode || document.getElementById('selMode').value,
    phase: document.getElementById('selPhase').value,
    subject: document.getElementById('selSubject').value,
    subtopicId: document.getElementById('selSubtopic').value,
    book: document.getElementById('selBook').value,
    chapter: document.getElementById('selChapter').value,
    section: document.getElementById('selSection').value,
    subtopicName: document.getElementById('selSubtopic').selectedOptions[0]?.textContent || '',
    pomodoroTime: state.session.finalFocusSeconds || state.session.totalFocusSeconds,
    readingTime: state.session.readingSeconds,
    frustration: 0,
    energy: 3,
    summaryExercises: total,
    summaryCorrect: problems.filter(p => p.result === 'correct').length,
    summaryIncorrect: problems.filter(p => p.result === 'incorrect').length,
    summaryUnresolved: problems.filter(p => p.result === 'unresolved').length,
    summaryReading: state.session.readingSeconds,
    summaryAverageTime: total ? totalTime / total : 0,
    summaryConjectures: conjectures.length,
    summaryDistractions: state.session.distractions,
    pomodoroLabel: 'pomodoro_' + Date.now()
  });

  if (sessionId) {
    await fixSessionId(state.session.tempId, sessionId);
    state.session.savedSessionId = sessionId;
  }
  return sessionId;
}

// ===================== SESSION SUMMARY MODAL =====================
async function showSessionSummary() {
  const problems = await db.sessions
    .where('type').equals('problem')
    .and(s => s.sessionId === state.session.savedSessionId)
    .toArray();

  const total = problems.length;
  const correct = problems.filter(p => p.result === 'correct').length;
  const incorrect = problems.filter(p => p.result === 'incorrect').length;
  const unresolved = problems.filter(p => p.result === 'unresolved').length;
  const totalTime = problems.reduce((a, p) => a + (p.timeSeconds || 0), 0);

  const conjectures = await db.conjectures
    .where('sessionId').equals(state.session.savedSessionId)
    .toArray();

  const focusSeconds = state.session.finalFocusSeconds || state.session.totalFocusSeconds;

  document.getElementById('summaryContent').innerHTML = `
    Focus time: ${formatTime(focusSeconds)}<br>
    Problems: ${total} (✅${correct} ❌${incorrect} ⚪${unresolved})<br>
    Reading time: ${Math.floor(state.session.readingSeconds / 60)}:${String(state.session.readingSeconds % 60).padStart(2, '0')}<br>
    Avg time / problem: ${total ? formatTime(totalTime / total) : '-'}<br>
    Conjectures: ${conjectures.length}<br>
    Distractions: ${state.session.distractions}
  `;
  document.getElementById('modalSummary').style.display = 'flex';

  const saved = await db.sessions.get(state.session.savedSessionId);
  if (saved) {
    document.getElementById('summaryFrustration').value = saved.frustration ?? 0;
    document.getElementById('summaryEnergy').value = saved.energy ?? 3;
  }
}