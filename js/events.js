import { state, PomodoroState, db, supabase } from './config.js';
import { showToast } from './utils.js';
import { transition } from './pomodoro.js';
import {
  updatePomodoroDisplay, updatePomodoroButtons,
  stopReadingInterval, updatePomodoroModeButton
} from './ui.js';
import { saveLocalAndOutbox, syncAll, pullChanges } from './sync.js';
import { refreshActivePanels } from './panels.js';
import {
  populateSubjects, populateSubtopics, populateBooks, updateChapters,
  populateSections, verifyAddSubject, verifyAddSubtopic, verifyAddSection,
  populateRecallGroups, applyRecallGroup
} from './selectors.js';
import { refreshSubtopicHistory, showPendingMistakes, updateUIForMode } from './reviews.js';
import { refreshSleepHistory, refreshSleepChart, calculateHours } from './sleepNotes.js';
import { refreshGoals, refreshChecklist } from './checklistGoals.js';
import { refreshComparison } from './comparison.js';

import { updateAuthUI } from './auth.js';

export function initEvents() {
  // ===================== MOBILE DRAWER =====================
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btnMenu = document.getElementById('btnMobileMenu');
  const btnClose = document.getElementById('btnSidebarClose');

  function openDrawer() {
    if (!sidebar || !backdrop) return;
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!sidebar || !backdrop) return;
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (btnMenu) btnMenu.addEventListener('click', openDrawer);
  if (btnClose) btnClose.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // ===================== NAVIGATION (sidebar) =====================
  const tabNav = document.getElementById('tabNav');
  if (tabNav) {
    tabNav.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(btn.dataset.panel);
      if (target) target.classList.add('active');

      refreshActivePanels();

      if (window.matchMedia('(max-width: 1200px)').matches) {
        closeDrawer();
      }
    });
  }

  // ===================== THEME TOGGLE =====================
  const THEME_KEY = 'sq-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.innerHTML = `<i data-lucide="${theme === 'dark' ? 'moon' : 'sun'}" aria-hidden="true"></i>`;
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    }
  }

  const btnThemeToggle = document.getElementById('btnThemeToggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);

      window.dispatchEvent(new CustomEvent('sq-theme-changed', { detail: { theme: next } }));
    });

    const persisted = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(persisted);
  }

  // ===================== AUTH =====================
  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) btnLogin.addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('#')[0] }
    });
  });

  // NOTE: Guest mode removed in R1 (owner-only app). Safe no-op.
  const btnGuest = document.getElementById('btn-guest');
  if (btnGuest) btnGuest.addEventListener('click', () => {
    localStorage.setItem('studyquantifier_guest', 'true');
    updateAuthUI({ user: { id: 'local-guest-user', email: 'guest@studyquantifier.local' } });
  });

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', async () => {
    localStorage.removeItem('studyquantifier_guest');
    try { await supabase.auth.signOut(); } catch (_) {}
    location.reload();
  });

  const btnLogoutTop = document.getElementById('btnLogoutTop');
  if (btnLogoutTop) btnLogoutTop.addEventListener('click', async () => {
    localStorage.removeItem('studyquantifier_guest');
    try { await supabase.auth.signOut(); } catch (_) {}
    location.reload();
  });

  // ===================== POMODORO CONTROLS =====================
  const btnStart = document.getElementById('btnPomoStart');
  if (btnStart) btnStart.addEventListener('click', () => {
    if (state.session.state !== PomodoroState.IDLE) return;
    state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value, 10) * 60;
    updatePomodoroDisplay();
    transition(PomodoroState.FOCUS_RUNNING);
  });

  const btnPause = document.getElementById('btnPomoPause');
  if (btnPause) btnPause.addEventListener('click', () => {
    if (state.session.state === PomodoroState.FOCUS_RUNNING) transition(PomodoroState.FOCUS_PAUSED);
    else if (state.session.state === PomodoroState.BREAK_RUNNING) transition(PomodoroState.BREAK_PAUSED);
  });

  const btnResume = document.getElementById('btnPomoResume');
  if (btnResume) btnResume.addEventListener('click', () => {
    if (state.session.state === PomodoroState.FOCUS_PAUSED) transition(PomodoroState.FOCUS_RUNNING);
    else if (state.session.state === PomodoroState.BREAK_PAUSED) transition(PomodoroState.BREAK_RUNNING);
  });

  const btnStop = document.getElementById('btnPomoStop');
  if (btnStop) btnStop.addEventListener('click', () => transition(PomodoroState.SESSION_ENDING));

  const btnReset = document.getElementById('btnPomoReset');
  if (btnReset) btnReset.addEventListener('click', async () => {
    await handleReset();
  });

  const btnPauseFloat = document.getElementById('btnPomoPauseFloat');
  if (btnPauseFloat) btnPauseFloat.addEventListener('click', () => {
    const st = state.session.state;
    if (st === PomodoroState.FOCUS_RUNNING || st === PomodoroState.BREAK_RUNNING) {
      transition(st === PomodoroState.FOCUS_RUNNING ? PomodoroState.FOCUS_PAUSED : PomodoroState.BREAK_PAUSED);
    } else if (st === PomodoroState.FOCUS_PAUSED || st === PomodoroState.BREAK_PAUSED) {
      transition(st === PomodoroState.FOCUS_PAUSED ? PomodoroState.FOCUS_RUNNING : PomodoroState.BREAK_RUNNING);
    }
  });

  const btnStopFloat = document.getElementById('btnPomoStopFloat');
  if (btnStopFloat) btnStopFloat.addEventListener('click', () => transition(PomodoroState.SESSION_ENDING));

  const btnResetFloat = document.getElementById('btnPomoResetFloat');
  if (btnResetFloat) btnResetFloat.addEventListener('click', async () => {
    await handleReset();
  });

  // ===================== RESET WITH LOSS AVERSION (video 3) =====================
  /**
   * Loss aversion: instead of a generic "session will be lost", we compute
   * exactly what the user stands to lose — problems registered, minutes
   * of focus, conjectures saved — and show it in the confirm dialog.
   *
   * If there's literally nothing to lose, skip the confirm entirely and
   * reset silently. Removing friction when there's no risk is itself a
   * UX win (video 3: "don't make users think when you already know the
   * answer").
   */
  async function handleReset() {
    const isIdle = state.session.state === PomodoroState.IDLE;
    if (isIdle) {
      // Nothing running. Silent reset.
      transition(PomodoroState.IDLE);
      refreshActivePanels();
      return;
    }

    // Gather what would be lost if the user resets right now.
    let problemCount = 0;
    let conjectureCount = 0;
    const focusSeconds = state.session.totalFocusSeconds || state.session.elapsedTotal || 0;
    const focusMinutes = Math.round(focusSeconds / 60);

    if (state.session.tempId) {
      problemCount = await db.sessions
        .where('type').equals('problem')
        .and(s => s.sessionId === state.session.tempId)
        .count();
      conjectureCount = await db.conjectures
        .where('sessionId').equals(state.session.tempId)
        .count();
    }

    // If nothing to lose, skip the confirm.
    const hasLoss = problemCount > 0 || conjectureCount > 0 || focusMinutes > 0;
    if (hasLoss) {
      const parts = [];
      if (problemCount > 0) {
        parts.push(`${problemCount} problem${problemCount === 1 ? '' : 's'}`);
      }
      if (focusMinutes > 0) {
        parts.push(`${focusMinutes} min of focus`);
      }
      if (conjectureCount > 0) {
        parts.push(`${conjectureCount} conjecture${conjectureCount === 1 ? '' : 's'}`);
      }

      const lostList = parts.length === 1
        ? parts[0]
        : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];

      const message = `Reset? You'll lose ${lostList}.\n\nThis can't be undone.`;

      if (!confirm(message)) return;
    }

    if (state.session.tempId) {
      await db.sessions.where('sessionId').equals(state.session.tempId).delete();
      await db.conjectures.where('sessionId').equals(state.session.tempId).delete();
    }
    transition(PomodoroState.IDLE);
    refreshActivePanels();
  }

  const btnToggleMode = document.getElementById('btnTogglePomodoroMode');
  if (btnToggleMode) btnToggleMode.addEventListener('click', () => {
    if (state.session.state !== PomodoroState.IDLE) {
      showToast('Switch mode when the session is stopped');
      return;
    }
    state.session.pomodoroMode = (state.session.pomodoroMode === 'countdown') ? 'timer' : 'countdown';
    updatePomodoroModeButton();
  });

  const btnCloseDetail = document.getElementById('btnCloseDetail');
  if (btnCloseDetail) btnCloseDetail.addEventListener('click', () => {
    document.getElementById('modalProblemDetail').style.display = 'none';
  });

  // ===================== SAVE SESSION SUMMARY =====================
  const btnSaveSummary = document.getElementById('btnSaveSummary');
  if (btnSaveSummary) btnSaveSummary.addEventListener('click', async () => {
    const sessionId = state.session.savedSessionId;
    if (!sessionId) {
      showToast('No session to save.');
      return;
    }

    const frustration = parseInt(document.getElementById('summaryFrustration').value, 10) || 0;
    const energy = parseInt(document.getElementById('summaryEnergy').value, 10) || 3;

    const existing = await db.sessions.get(sessionId);
    if (existing) {
      await saveLocalAndOutbox('sessions', {
        ...existing,
        frustration,
        energy
      }, 'id');
    }

    document.getElementById('modalSummary').style.display = 'none';
    transition(PomodoroState.IDLE);
    refreshActivePanels();
  });

  const btnCancelSummary = document.getElementById('btnCancelSummary');
  if (btnCancelSummary) btnCancelSummary.addEventListener('click', async () => {
    const sessionId = state.session.savedSessionId;
    const tempId = state.session.tempId;
    const userId = state.currentSession?.user?.id;

    if (sessionId && userId) {
      const now = new Date().toISOString();
      const childProblems = await db.sessions.where('sessionId').equals(sessionId).toArray();
      const childConjectures = await db.conjectures.where('sessionId').equals(sessionId).toArray();

      await db.sessions.delete(sessionId);
      await db.outbox.put({
        table: 'sessions',
        recordId: sessionId,
        operation: 'delete',
        data: { id: sessionId, userId, deletedAt: now },
        onConflict: 'id',
        createdAt: now
      });

      for (const p of childProblems) {
        await db.sessions.delete(p.id);
        await db.outbox.put({
          table: 'sessions',
          recordId: p.id,
          operation: 'delete',
          data: { id: p.id, userId, deletedAt: now },
          onConflict: 'id',
          createdAt: now
        });
      }

      for (const c of childConjectures) {
        await db.conjectures.delete(c.id);
        await db.outbox.put({
          table: 'conjectures',
          recordId: c.id,
          operation: 'delete',
          data: { id: c.id, userId, deletedAt: now },
          onConflict: 'id',
          createdAt: now
        });
      }

      if (tempId) {
        await db.sessions.where('sessionId').equals(tempId).delete();
        await db.conjectures.where('sessionId').equals(tempId).delete();
      }
    }

    document.getElementById('modalSummary').style.display = 'none';
    transition(PomodoroState.IDLE);
    refreshActivePanels();
  });

  // ===================== DISTRACTION / READING =====================
  const logDistraction = () => {
    if (state.session.state !== PomodoroState.FOCUS_RUNNING
      && state.session.state !== PomodoroState.BREAK_RUNNING) return;
    state.session.distractions++;
    showToast('logged ✅', 1500);
  };
  const btnDistract = document.getElementById('btnDistract');
  if (btnDistract) btnDistract.addEventListener('click', logDistraction);
  const btnDistractFloat = document.getElementById('btnDistractFloat');
  if (btnDistractFloat) btnDistractFloat.addEventListener('click', logDistraction);

  function setReadingIcon(iconName) {
    ['readingIconFloat', 'readingIconFloatB'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const newIcon = document.createElement('i');
      newIcon.setAttribute('data-lucide', iconName);
      newIcon.setAttribute('aria-hidden', 'true');
      newIcon.id = id;
      el.replaceWith(newIcon);
    });
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function updateReadingDisplays(display) {
    const a = document.getElementById('readingTotal');
    if (a) a.textContent = display;
    const b = document.getElementById('readingTotalFloat');
    if (b) b.textContent = display;
    const c = document.getElementById('readingTotalFloatB');
    if (c) c.textContent = display;
  }

  function toggleReading() {
    if (!state.session.readingRunning) {
      if (state.session.state !== PomodoroState.FOCUS_RUNNING
        && state.session.state !== PomodoroState.BREAK_RUNNING) return;

      state.session.readingRunning = true;
      const start = Date.now() - state.session.readingSeconds * 1000;

      state.session.readingInterval = setInterval(() => {
        state.session.readingSeconds = Math.round((Date.now() - start) / 1000);
        const m = Math.floor(state.session.readingSeconds / 60);
        const s = state.session.readingSeconds % 60;
        updateReadingDisplays(`${m}:${String(s).padStart(2, '0')}`);
      }, 1000);

      setReadingIcon('square');
    } else {
      stopReadingInterval();
      setReadingIcon('play');
    }
  }

  const btnReadingStart = document.getElementById('btnReadingStart');
  if (btnReadingStart) btnReadingStart.addEventListener('click', () => {
    if (!state.session.readingRunning) toggleReading();
  });

  const btnReadingStop = document.getElementById('btnReadingStop');
  if (btnReadingStop) btnReadingStop.addEventListener('click', () => {
    if (state.session.readingRunning) stopReadingInterval();
  });

  const btnReadingToggleFloat = document.getElementById('btnReadingToggleFloat');
  if (btnReadingToggleFloat) btnReadingToggleFloat.addEventListener('click', toggleReading);

  const btnReadingToggleFloatB = document.getElementById('btnReadingToggleFloatB');
  if (btnReadingToggleFloatB) btnReadingToggleFloatB.addEventListener('click', toggleReading);

  // ===================== ADD SUBJECT/SUBTOPIC/SECTION =====================
  const btnAddSubject = document.getElementById('btnAddSubject');
  if (btnAddSubject) btnAddSubject.addEventListener('click', async () => {
    const input = document.getElementById('newSubject');
    const name = input.value.trim();
    if (!name) return;

    await saveLocalAndOutbox('subjects', { name }, 'userId,name');
    await populateSubjects();

    const selSubject = document.getElementById('selSubject');
    selSubject.value = name;
    input.value = '';
    verifyAddSubject();
    selSubject.dispatchEvent(new Event('change'));
  });

  const btnAddSubtopic = document.getElementById('btnAddSubtopic');
  if (btnAddSubtopic) btnAddSubtopic.addEventListener('click', async () => {
    const subject = document.getElementById('selSubject').value;
    const name = document.getElementById('newSubtopic').value.trim();
    if (!subject || subject === '__add__' || !name) return;

    const id = await saveLocalAndOutbox('extraSubtopics', {
      subject,
      name,
      stage: 'Custom'
    });

    await populateSubtopics(subject);
    document.getElementById('selSubtopic').value = 'extra_' + id;
    document.getElementById('newSubtopic').value = '';
    verifyAddSubtopic();

    state.currentProblemNumber = 1;
    document.getElementById('numProblem').value = 1;
  });

  const btnAddSection = document.getElementById('btnAddSection');
  if (btnAddSection) btnAddSection.addEventListener('click', async () => {
    const subject = document.getElementById('selSubject').value;
    const book = document.getElementById('selBook').value;
    const name = document.getElementById('newSection').value.trim();
    if (!subject || !book || !name) return;

    await saveLocalAndOutbox('bookSections', { subject, book, name }, 'id');
    document.getElementById('newSection').value = '';
    await populateSections(subject, book);
    document.getElementById('selSection').value = name;
    verifyAddSection();
  });

  // ===================== SLEEP + GOALS =====================
  const btnSaveSleep = document.getElementById('btnSaveSleep');
  if (btnSaveSleep) btnSaveSleep.addEventListener('click', async () => {
    const date = document.getElementById('dateSleep').value;
    const bedtime = document.getElementById('bedtimeSleep').value;
    const wakeup = document.getElementById('wakeupSleep').value;
    const hours = calculateHours(bedtime, wakeup);
    const quality = parseFloat(document.getElementById('qualitySleep').value);

    if (!date || isNaN(quality)) return;

    await saveLocalAndOutbox('sleep', {
      date,
      hours,
      quality,
      timestamp: new Date().toISOString(),
      bedtime: bedtime + ':00',
      wakeup: wakeup + ':00'
    }, 'userId,date');

    document.getElementById('qualitySleep').value = '';
    document.getElementById('bedtimeSleep').value = '';
    document.getElementById('wakeupSleep').value = '';
    document.getElementById('calculatedHours').textContent = '--';
    showToast('Sleep logged ✅');
    refreshSleepHistory();
    refreshSleepChart();
  });

  const btnSaveGoals = document.getElementById('btnSaveGoals');
  if (btnSaveGoals) btnSaveGoals.addEventListener('click', async () => {
    const daily = parseFloat(document.getElementById('dailyGoal').value) || 3;
    const weekly = parseFloat(document.getElementById('weeklyGoal').value) || 15;

    await saveLocalAndOutbox('goals', { key: 'dailyGoal', value: daily }, 'userId,key');
    await saveLocalAndOutbox('goals', { key: 'weeklyGoal', value: weekly }, 'userId,key');
    await saveLocalAndOutbox('goals', { key: 'activeGoalDays', value: state.activeGoalDays }, 'userId,key');

    refreshGoals();
    showToast('Goals saved ✅');
  });

  const activeDaysContainer = document.getElementById('activeGoalDays');
  if (activeDaysContainer) activeDaysContainer.addEventListener('click', e => {
    const btn = e.target.closest('button[data-day]');
    if (!btn) return;
    const day = parseInt(btn.dataset.day, 10);

    if (state.activeGoalDays.includes(day)) {
      state.activeGoalDays = state.activeGoalDays.filter(d => d !== day);
      btn.classList.remove('active');
    } else {
      state.activeGoalDays.push(day);
      btn.classList.add('active');
    }

    saveLocalAndOutbox('goals', {
      key: 'activeGoalDays',
      value: state.activeGoalDays
    }, 'userId,key');
  });

  // ===================== EXPORT / IMPORT / SYLLABUS / SYNC =====================
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.addEventListener('click', async () => {
    const data = {
      sessions: await db.sessions.toArray(),
      conjectures: await db.conjectures.toArray(),
      sleep: await db.sleep.toArray(),
      subjects: await db.subjects.toArray(),
      extraSubtopics: await db.extraSubtopics.toArray(),
      goals: await db.goals.toArray(),
      mistakes: await db.mistakes.toArray(),
      reviews: await db.reviews.toArray(),
      fsrsWeights: await db.fsrsWeights.toArray(),
      topicMastery: await db.topicMastery.toArray(),
      syllabus: await db.syllabus.toArray(),
      bookSections: await db.bookSections.toArray(),
      checklist: await db.checklist.toArray(),
      outbox: await db.outbox.toArray(),
      syncMetadata: await db.syncMetadata.toArray()
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'studyquantifier_backup.json';
    a.click();
  });

  const btnImport = document.getElementById('btnImport');
  if (btnImport) btnImport.addEventListener('click', () => document.getElementById('importFile').click());

  const importFile = document.getElementById('importFile');
  if (importFile) importFile.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());

      const tableMap = {
        sessions: 'sessions',
        conjectures: 'conjectures',
        sleep: 'sleep',
        subjects: 'subjects',
        extraSubtopics: 'extraSubtopics',
        goals: 'goals',
        mistakes: 'mistakes',
        reviews: 'reviews',
        fsrsWeights: 'fsrsWeights',
        topicMastery: 'topicMastery',
        syllabus: 'syllabus',
        bookSections: 'bookSections',
        checklist: 'checklist',
        syncMetadata: 'syncMetadata'
      };

      for (const [key, table] of Object.entries(tableMap)) {
        if (Array.isArray(data[key])) {
          await db[table].clear();
          await db[table].bulkPut(data[key]);
        }
      }

      await syncAll({ silent: true });
      refreshActivePanels();
      showToast('Data imported.');
    } catch (e) {
      console.error(e);
      showToast('Import error.');
    }
    this.value = '';
  });

  const btnLoadSyllabus = document.getElementById('btnLoadSyllabus');
  if (btnLoadSyllabus) btnLoadSyllabus.addEventListener('click', () => document.getElementById('syllabusFile').click());

  const syllabusFile = document.getElementById('syllabusFile');
  if (syllabusFile) syllabusFile.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) || !data.every(t => t.subject && t.name)) {
        showToast('Invalid syllabus format (expected a list with subject and name).');
        this.value = '';
        return;
      }
      state.currentSyllabus.length = 0;
      state.currentSyllabus.push(...data);
      await db.syllabus.put({ key: 'active', content: data, updatedAt: new Date().toISOString() });
      await populateSubjects();
      const selSubject = document.getElementById('selSubject');
      if (selSubject) selSubject.dispatchEvent(new Event('change'));
      await refreshChecklist();
      await refreshComparison();
      showToast('Syllabus loaded ✅');
    } catch (e) {
      console.error(e);
      showToast('Syllabus load error.');
    }
    this.value = '';
  });

  const btnSyncNow = document.getElementById('btnSyncNow');
  if (btnSyncNow) btnSyncNow.addEventListener('click', async () => {
    if (!state.currentSession?.user) {
      showToast('Sign in first', 2000);
      return;
    }
    const pending = await db.outbox.count();
    if (pending === 0) {
      showToast('Nothing to sync');
      await pullChanges();
      refreshActivePanels();
      return;
    }
    showToast('Syncing…', 1500);
    await syncAll({ silent: false });
    await pullChanges();
    refreshActivePanels();
  });

  // ===================== MOBILE ACTION MIRRORS =====================
  const mobileMirrors = [
    ['btnExportMobile', 'btnExport'],
    ['btnImportMobile', 'btnImport'],
    ['btnLoadSyllabusMobile', 'btnLoadSyllabus'],
    ['btnSyncNowMobile', 'btnSyncNow']
  ];
  mobileMirrors.forEach(([mobileId, targetId]) => {
    const mobileBtn = document.getElementById(mobileId);
    if (!mobileBtn) return;
    mobileBtn.addEventListener('click', () => {
      const target = document.getElementById(targetId);
      if (target) target.click();
      if (mobileId === 'btnSyncNowMobile' && window.matchMedia('(max-width: 1200px)').matches) {
        closeDrawer();
      }
    });
  });

  // ===================== COMPARISON PANEL =====================
  const comparisonDate = document.getElementById('comparisonDate');
  if (comparisonDate) comparisonDate.addEventListener('change', () => refreshComparison());

  const comparisonSubject = document.getElementById('comparisonSubject');
  if (comparisonSubject) comparisonSubject.addEventListener('change', () => refreshComparison());

  const comparisonWeek = document.getElementById('comparisonWeek');
  if (comparisonWeek) comparisonWeek.addEventListener('change', () => refreshComparison());

  // ===================== MODE SELECTOR =====================
  const selMode = document.getElementById('selMode');
  if (selMode) selMode.addEventListener('change', async function () {
    state.session.mode = this.value;
    await updateUIForMode();
  });

  // ===================== SUBJECT SELECTOR =====================
  const selSubject = document.getElementById('selSubject');
  if (selSubject) selSubject.addEventListener('change', async function () {
    if (this.value === '__add__') {
      verifyAddSubject();
      return;
    }
    verifyAddSubject();
    state.currentProblemNumber = 1;
    document.getElementById('numProblem').value = 1;

    try {
      await populateSubtopics(this.value);

      const selSubtopic = document.getElementById('selSubtopic');
      await populateBooks(selSubtopic.value);

      if (state.session.mode === 'B') {
        state.currentRecallGroup = null;
        await populateRecallGroups(this.value);
        document.getElementById('selPendingMistake').innerHTML = '<option value="">Select a group first</option>';
      }

      if (document.getElementById('active-view').classList.contains('active')) {
        await refreshSubtopicHistory();
        document.getElementById('nombreSubtopicHistory').textContent = this.selectedOptions[0]?.textContent || '';
      }
    } catch (e) {
      console.error('Error on subject change:', e);
    }
  });

  // ===================== SUBTOPIC SELECTOR =====================
  const selSubtopic = document.getElementById('selSubtopic');
  if (selSubtopic) selSubtopic.addEventListener('change', async function () {
    verifyAddSubtopic();
    await populateBooks(this.value);

    if (this.value !== '__add__') {
      state.currentProblemNumber = 1;
      document.getElementById('numProblem').value = 1;
    }

    if (document.getElementById('active-view').classList.contains('active')) {
      refreshSubtopicHistory();

      const book = document.getElementById('selBook').value;
      const previous = await db.sessions
        .where('type').equals('problem')
        .and(p => p.subtopicId === this.value && p.book === book)
        .toArray();

      const maxNumber = previous.reduce((max, p) => Math.max(max, p.problemNumber || 0), 0);
      document.getElementById('numProblem').value = maxNumber + 1;
      state.currentProblemNumber = maxNumber + 1;
      document.getElementById('nombreSubtopicHistory').textContent = this.selectedOptions[0]?.textContent || '';

      if (state.session.mode === 'B') showPendingMistakes();
    }
  });

  // ===================== BOOK SELECTOR =====================
  const selBook = document.getElementById('selBook');
  if (selBook) selBook.addEventListener('change', async function () {
    updateChapters(this.value, document.getElementById('selSubtopic').value);
    await populateSections(document.getElementById('selSubject').value, this.value);
    verifyAddSection();
  });

  // ===================== SECTION SELECTOR =====================
  const selSection = document.getElementById('selSection');
  if (selSection) selSection.addEventListener('change', function () {
    verifyAddSection();
    if (document.getElementById('active-view').classList.contains('active')) {
      refreshSubtopicHistory();
    }
  });

  // ===================== RECALL GROUP LIST (Mode B) =====================
  const recallGroupList = document.getElementById('recallGroupList');
  if (recallGroupList) {
    recallGroupList.addEventListener('click', async (e) => {
      const item = e.target.closest('.recall-group-item');
      if (!item) return;
      if (item.classList.contains('disabled')) return;

      const key = item.dataset.key;
      if (!key) return;

      if (state.currentRecallGroup) {
        const activeKey = `${state.currentRecallGroup.subject}|${state.currentRecallGroup.book}|${state.currentRecallGroup.subtopicId}|${state.currentRecallGroup.section}`;
        if (activeKey === key) {
          state.currentRecallGroup = null;
          document.querySelectorAll('#recallGroupList .recall-group-item').forEach(el => el.classList.remove('active'));
          document.getElementById('nombreSubtopicHistory').textContent = '—';
          document.getElementById('selPendingMistake').innerHTML = '<option value="">Select a group first</option>';
          return;
        }
      }

      await applyRecallGroup(key);
      document.querySelectorAll('#recallGroupList .recall-group-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });
  }

  // ===================== SLEEP (calculated hours) =====================
  const bedtimeSleep = document.getElementById('bedtimeSleep');
  const wakeupSleep = document.getElementById('wakeupSleep');
  if (bedtimeSleep) bedtimeSleep.addEventListener('change', updateCalculatedHours);
  if (wakeupSleep) wakeupSleep.addEventListener('change', updateCalculatedHours);

  function updateCalculatedHours() {
    const bedtime = document.getElementById('bedtimeSleep').value;
    const wakeup = document.getElementById('wakeupSleep').value;
    const hours = calculateHours(bedtime, wakeup);
    const el = document.getElementById('calculatedHours');
    if (el) el.textContent = hours ? hours + ' h' : '--';
  }

  // ===================== UNSAVED SESSION WARNING =====================
  window.addEventListener('beforeunload', (e) => {
    const sessionActive = state.session.state !== PomodoroState.IDLE
      && state.session.state !== PomodoroState.SESSION_ENDING;
    const problemRunning = state.blindTimer.running;

    if (sessionActive || problemRunning) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}