import { state, db } from './config.js';
import { syncAll } from './sync.js';
import { todayLocal } from './utils.js';
import { refreshActivePanels } from './panels.js';
import {
  updatePomodoroDisplay,
  updatePomodoroStatusText,
  updatePomodoroButtons,
  setConfigEnabled,
  updatePomodoroModeButton
} from './ui.js';
import { populateSubjects, verifyAddSubject } from './selectors.js';

// ===================== AUTH UI =====================
export function updateAuthUI(session) {
  state.currentSession = session;

  const authStatus = document.getElementById('auth-status');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  const appContent = document.getElementById('app-content');
  const userEmail = document.getElementById('user-email');
  const authSection = document.getElementById('auth-section');

  if (session?.user) {
    if (authStatus) authStatus.textContent = `Signed in as ${session.user.email}`;
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
    if (appContent) appContent.style.display = 'flex'; // <- flex, not block
    if (userEmail) userEmail.textContent = session.user.email;
    if (authSection) authSection.classList.add('hidden');

    if (!state.appInitialized) {
      state.appInitialized = true;
      initApp();
    }
  } else {
    state.appInitialized = false;
    if (authStatus) authStatus.textContent = 'You are not signed in.';
    if (btnLogin) btnLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
    if (appContent) appContent.style.display = 'none';
    if (authSection) authSection.classList.remove('hidden');
  }
}

// ===================== INITIALIZATION =====================
export async function initApp() {
  await syncAll({ silent: true });

  const storedSyllabus = await db.syllabus.get('active');
  if (storedSyllabus?.content) {
    state.currentSyllabus.length = 0;
    state.currentSyllabus.push(...storedSyllabus.content);
  }

  const storedDays = await db.goals.get('activeGoalDays');
  if (storedDays && Array.isArray(storedDays.value)) {
    state.activeGoalDays = storedDays.value;
  }
  markActiveDays();

  await populateSubjects();
  verifyAddSubject();

  const selSubject = document.getElementById('selSubject');
  if (selSubject) selSubject.dispatchEvent(new Event('change'));

  const dateSleep = document.getElementById('dateSleep');
  if (dateSleep) dateSleep.value = todayLocal();

  updatePomodoroDisplay();
  updatePomodoroStatusText();
  updatePomodoroButtons();
  updatePomodoroModeButton();
  setConfigEnabled(true);

  const btnDistract = document.getElementById('btnDistract');
  if (btnDistract) btnDistract.disabled = true;
  const btnReadingStart = document.getElementById('btnReadingStart');
  if (btnReadingStart) btnReadingStart.disabled = true;
  const btnReadingStop = document.getElementById('btnReadingStop');
  if (btnReadingStop) btnReadingStop.disabled = true;

  refreshActivePanels();
}

// ===================== ACTIVE GOAL DAYS =====================
function markActiveDays() {
  const container = document.getElementById('activeGoalDays');
  if (!container) return;
  container.querySelectorAll('button[data-day]').forEach(btn => {
    const day = parseInt(btn.dataset.day, 10);
    if (state.activeGoalDays.includes(day)) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}