import { showToast, formatTime, todayLocal } from './utils.js';
import { db, state, PomodoroState } from './config.js';
import { saveLocalAndOutbox } from './sync.js';
import { updateBlindDisplay } from './ui.js';
import { transition } from './pomodoro.js';
import { createMistakeFromProblem, refreshSubtopicHistory, refreshSessionConjectures } from './reviews.js';

// ===================== PROBLEM (BLIND) TIMER =====================
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

  document.getElementById('cardResult').style.display = 'block';
  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.remove('timer-running');
  document.getElementById('timerDisplay').style.display = 'none';
  document.getElementById('conjecture-inline').classList.add('hidden');
  document.getElementById('left-panel').classList.add('hidden');

  state.blindTimer.pendingResult = true;
}

// ===================== TOUCH PROTECTION =====================
let lastToggleTime = 0;
function shouldToggle() {
  const now = Date.now();
  if (now - lastToggleTime < 300) return false;
  lastToggleTime = now;
  return true;
}

// ===================== KEYBOARD =====================
document.addEventListener('keydown', e => {
  // 'd' = log a distraction
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (state.session.state !== PomodoroState.IDLE && state.session.state !== PomodoroState.SESSION_ENDING) {
      const tag = document.activeElement?.tagName;
      if (!document.activeElement || tag === 'BODY') {
        e.preventDefault();
        state.session.distractions++;
        showToast('Distraction logged', 1500);
      }
    }
  }

  // Space = stop the current problem (if running)
  if (e.key === ' ' || e.code === 'Space') {
    const tag = document.activeElement?.tagName;
    if (document.activeElement && tag !== 'BODY') return;
    if (document.getElementById('modalSummary')?.style.display === 'flex') return;
    if (state.session.state === PomodoroState.IDLE || state.session.state === PomodoroState.SESSION_ENDING) return;
    if (state.blindTimer.running) {
      e.preventDefault();
      stopBlindTimerAndShowResult();
    }
  }
});

document.addEventListener('keyup', e => {
  // Space = start a new problem (if not running / not pending result)
  if (e.key === ' ' || e.code === 'Space') {
    const tag = document.activeElement?.tagName;
    if (document.activeElement && tag !== 'BODY') return;
    if (state.session.state === PomodoroState.IDLE || state.session.state === PomodoroState.SESSION_ENDING) return;
    if (!state.blindTimer.running && !state.blindTimer.pendingResult) {
      e.preventDefault();
      startBlindTimer();
    }
  }
});

// ===================== TOUCH EVENTS =====================
const activeViewElement = document.getElementById('active-view');

function isInteractive(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (['button', 'select', 'input', 'textarea', 'a', 'label'].includes(tag)) return true;
  return !!target.closest('button, select, input, textarea, a, label');
}

if (activeViewElement) {
  activeViewElement.addEventListener('touchstart', (e) => {
    if (isInteractive(e.target)) return;
    if (!state.blindTimer.running && !state.blindTimer.pendingResult) {
      activeViewElement.classList.add('touch-pressed');
    }
  }, { passive: true });

  activeViewElement.addEventListener('touchend', (e) => {
    activeViewElement.classList.remove('touch-pressed');
    if (isInteractive(e.target)) return;
    if (!shouldToggle()) return;
    if (state.blindTimer.running) {
      e.preventDefault();
      stopBlindTimerAndShowResult();
    } else if (!state.blindTimer.pendingResult) {
      e.preventDefault();
      startBlindTimer();
    }
  }, { passive: false });

  activeViewElement.addEventListener('click', (e) => {
    if (isInteractive(e.target)) return;
    if (!shouldToggle()) return;
    if (state.blindTimer.running) {
      stopBlindTimerAndShowResult();
    }
  });
}

// ===================== RESULT TOGGLE (MODE A) =====================
document.getElementById('toggleResult').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleResult .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const val = e.target.dataset.val;

  document.getElementById('divErrorCode').style.display = (val === 'incorrect' || val === 'unresolved') ? 'block' : 'none';
  document.getElementById('divConfidence').style.display = (val === 'unresolved') ? 'none' : 'block';
  document.getElementById('divProblemNote').style.display = (val === 'incorrect' || val === 'unresolved') ? 'block' : 'none';

  const selError = document.getElementById('selErrorCode');
  if (val === 'incorrect') {
    selError.innerHTML = '<option value="">None</option><option>EA</option><option>EC</option><option>EP</option><option>ET</option>';
  } else if (val === 'unresolved') {
    selError.innerHTML = '<option value="">None</option><option>UR-I</option><option>UR-B</option>';
  }
});

// ===================== NEXT PROBLEM (MODE A) =====================
document.getElementById('btnNextProblem').addEventListener('click', async () => {
  const mode = document.getElementById('selMode').value;
  const phase = document.getElementById('selPhase').value;
  const subject = document.getElementById('selSubject').value;
  const subtopic = document.getElementById('selSubtopic').value;
  const resultBtn = document.querySelector('#toggleResult .toggle-btn.active');
  if (!resultBtn) return;

  const result = resultBtn.dataset.val;
  const errorCode = (result === 'incorrect' || result === 'unresolved')
    ? document.getElementById('selErrorCode').value
    : null;
  const confidence = (result === 'unresolved') ? null : parseInt(document.getElementById('selConfidence').value, 10);
  const note = (result === 'incorrect' || result === 'unresolved')
    ? document.getElementById('problemNote').value.trim()
    : null;

  const subtopicName = document.getElementById('selSubtopic').selectedOptions[0]?.textContent || '';
  const section = document.getElementById('selSection')?.value || null;
  const book = document.getElementById('selBook').value || null;
  const chapter = document.getElementById('selChapter').value || null;

  const problemId = await saveLocalAndOutbox('sessions', {
    type: 'problem',
    date: todayLocal(),
    timestamp: Date.now(),
    mode, phase, subject,
    subtopicId: subtopic,
    subtopicName,
    book,
    chapter,
    section,
    problemNumber: state.blindTimer.previousProblemNumber,
    timeSeconds: Math.round(state.blindTimer.seconds * 10) / 10,
    result,
    errorCode,
    note,
    perceivedDifficulty: parseInt(document.getElementById('selDifficulty').value, 10),
    confidence,
    attempts: parseInt(document.getElementById('numAttempts').value, 10) || 1,
    bloomLevel: parseInt(document.getElementById('selBloom').value, 10),
    sessionId: state.session.tempId
  });

  // Create a mistake record for incorrect / unresolved problems in Mode A
  if (mode === 'A' && (result === 'incorrect' || result === 'unresolved')) {
    await createMistakeFromProblem({
      subject,
      subtopicId: subtopic,
      subtopicName,
      label: errorCode,
      phase,
      originProblemId: problemId,
      book,
      section
    });
  }

  if (mode !== 'B') {
    document.getElementById('numProblem').value = state.blindTimer.previousProblemNumber + 1;
    state.currentProblemNumber = state.blindTimer.previousProblemNumber + 1;
  }

  // Reset result card & UI
  document.getElementById('cardResult').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjecture-inline').classList.remove('hidden');
  document.getElementById('problemNote').value = '';
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;

  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.remove('timer-running');

  document.getElementById('left-panel').classList.remove('hidden');
  document.getElementById('session-conjectures-wrap').style.display = 'block';

  refreshSessionConjectures();

  const { refreshMetrics } = await import('./metrics.js');
  const { refreshAll } = await import('./app.js');
  refreshMetrics();
  refreshAll();
  refreshSubtopicHistory();

  // If the pomodoro already ended, transition now
  if (state.session.pendingSessionEnd) {
    state.session.pendingSessionEnd = false;
    const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 0;
    if (breakMinutes > 0) {
      await transition(PomodoroState.BREAK_RUNNING);
    } else {
      await transition(PomodoroState.SESSION_ENDING);
    }
  }
});

// ===================== DISCARD PROBLEM =====================
document.getElementById('btnDiscardProblem').addEventListener('click', async () => {
  if (state.session.mode !== 'B') {
    document.getElementById('numProblem').value = state.blindTimer.previousProblemNumber;
    state.currentProblemNumber = state.blindTimer.previousProblemNumber;
  }

  document.getElementById('cardResult').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjecture-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;

  const activeView = document.getElementById('active-view');
  if (activeView) activeView.classList.remove('timer-running');

  document.getElementById('left-panel').classList.remove('hidden');
  refreshSubtopicHistory();

  if (state.session.pendingSessionEnd) {
    state.session.pendingSessionEnd = false;
    const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 0;
    if (breakMinutes > 0) {
      await transition(PomodoroState.BREAK_RUNNING);
    } else {
      await transition(PomodoroState.SESSION_ENDING);
    }
  }
});

// ===================== SAVE CONJECTURE =====================
document.getElementById('btnSaveConjecture').addEventListener('click', async () => {
  const text = document.getElementById('conjectureText').value.trim();
  if (!text) return;

  // In Mode B, prefer the active recall group's subject/subtopic.
  const group = state.currentRecallGroup;
  const mode = state.session.mode;

  const subject = (mode === 'B' && group)
    ? group.subject
    : document.getElementById('selSubject').value;

  const subtopic = (mode === 'B' && group)
    ? group.subtopicId
    : document.getElementById('selSubtopic').value;

  const problemNumber = (state.blindTimer.running || state.blindTimer.pendingResult)
    ? state.blindTimer.previousProblemNumber
    : null;

  await saveLocalAndOutbox('conjectures', {
    date: todayLocal(),
    text,
    subject: subject !== '__add__' ? subject : null,
    subtopicId: subtopic !== '__add__' ? subtopic : null,
    problemNumber,
    sessionId: state.session.tempId,
    timestamp: Date.now()
  });

  document.getElementById('conjectureText').value = '';
  showToast('Conjecture saved');
});