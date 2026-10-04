import { showToast, formatTime, todayLocal } from './utils.js';
import { db, state, PomodoroState } from './config.js';
import { saveLocalAndOutbox, syncAll } from './sync.js';
import { updateBlindDisplay } from './ui.js';
import { transition } from './pomodoro.js';
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  State as FSRSState
} from 'https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm';

// ===================== PENDING MISTAKES SELECTOR =====================
document.getElementById('selPendingMistake').addEventListener('change', function () {
  const mistakeId = this.value;
  state.selectedMistake = state.pendingMistakes.find(m => String(m.id) === mistakeId) || null;
});

export async function showPendingMistakes() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  let mistakes = (await db.mistakes.where('status').equals('active').toArray())
    .filter(m => new Date(m.nextReview) <= endOfToday);

  if (state.session.mode === 'B' && state.currentRecallGroup) {
    const g = state.currentRecallGroup;
    mistakes = mistakes.filter(m =>
      m.subject === g.subject &&
      (m.book || 'No book') === g.book &&
      (m.subtopicId || 'no-subtopic') === g.subtopicId &&
      (m.section || 'No section') === g.section
    );
  } else if (state.session.mode !== 'B') {
    const subject = document.getElementById('selSubject').value;
    const subtopic = document.getElementById('selSubtopic').value;
    mistakes = mistakes.filter(m => m.subject === subject && m.subtopicId === subtopic);
  } else {
    mistakes = [];
  }

  mistakes.sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview));

  const originIds = mistakes.map(m => m.originSessionId).filter(Boolean);
  const originSessions = originIds.length ? await db.sessions.bulkGet(originIds) : [];
  const sessionById = new Map();
  originIds.forEach((id, i) => { if (originSessions[i]) sessionById.set(id, originSessions[i]); });

  state.pendingMistakes = mistakes;

  const select = document.getElementById('selPendingMistake');
  select.innerHTML = '';

  if (mistakes.length === 0) {
    select.innerHTML = '<option value="">No pending mistakes</option>';
    state.selectedMistake = null;
    return;
  }

  mistakes.forEach(m => {
    const problemNumber = sessionById.get(m.originSessionId)?.problemNumber ?? '?';
    const option = document.createElement('option');
    option.value = m.id;
    option.textContent = `Problem #${problemNumber} – ${m.label || '—'} (due ${new Date(m.nextReview).toLocaleDateString()})`;
    select.appendChild(option);
  });

  select.selectedIndex = 0;
  state.selectedMistake = mistakes[0];
}

// ===================== MODE-SPECIFIC UI =====================
export async function updateUIForMode() {
  const isModeB = state.session.mode === 'B';

  const hideInModeB = [
    'wrap-sel-subtopic',
    'wrap-sel-book',
    'wrap-sel-chapter',
    'wrap-sel-section',
    'input-num-problem',
    'addSubtopicRow',
    'addSectionRow',
    'addSubjectRow'
  ];
  hideInModeB.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isModeB ? 'none' : '';
  });

  const selPending = document.getElementById('sel-pending-mistake');
  if (selPending) selPending.style.display = isModeB ? 'block' : 'none';

  const selType = document.getElementById('selProblemType');
  if (selType) {
    const wrapper = selType.closest('div');
    if (wrapper) wrapper.style.display = isModeB ? 'none' : '';
  }

  const wrapGroup = document.getElementById('wrap-sel-recall-group');
  if (wrapGroup) wrapGroup.style.display = isModeB ? 'block' : 'none';

  document.getElementById('formResultA').style.display = isModeB ? 'none' : 'block';
  document.getElementById('formResultB').style.display = isModeB ? 'block' : 'none';

  if (isModeB) {
    const { populateRecallGroups } = await import('./selectors.js');
    const subject = document.getElementById('selSubject').value;

    // Rebuild the scrollable list of recall groups.
    // `populateRecallGroups()` reads `state.currentRecallGroup` and marks the
    // matching item as `.active`, so we don't need to touch the DOM here.
    await populateRecallGroups(subject);

    if (!state.currentRecallGroup) {
      document.getElementById('selPendingMistake').innerHTML = '<option value="">Select a group first</option>';
    } else {
      await showPendingMistakes();
    }
  } else {
    state.currentRecallGroup = null;
    await showPendingMistakes();
  }
}

// ===================== SUBTOPIC HISTORY (ACCORDION) =====================
export async function refreshSubtopicHistory() {
  const currentMode = state.session.mode || 'A';

  let subtopicId, currentBook, currentSection;
  if (currentMode === 'B' && state.currentRecallGroup) {
    const g = state.currentRecallGroup;
    subtopicId = g.subtopicId;
    currentBook = g.book;
    currentSection = g.section;
  } else {
    subtopicId = document.getElementById('selSubtopic').value;
    currentBook = document.getElementById('selBook').value;
    currentSection = document.getElementById('selSection')?.value;
  }

  if (!subtopicId || subtopicId === '__add__') return;

  let problems = await db.sessions
    .where('type').equals('problem')
    .and(p => p.subtopicId === subtopicId && p.book === currentBook)
    .toArray();

  if (currentMode !== 'B') {
    problems = problems.filter(p => p.mode === currentMode);
  }

  if (currentSection && currentSection !== '__add__') {
    problems = problems.filter(p => p.section === currentSection);
  }

  const groupsMap = {};
  problems.forEach(p => {
    const sid = p.sessionId || 'no-session';
    if (!groupsMap[sid]) groupsMap[sid] = [];
    groupsMap[sid].push(p);
  });

  const groupsArray = Object.entries(groupsMap)
    .map(([sid, probs]) => {
      const minTime = Math.min(...probs.map(p => new Date(p.timestamp || p.date).getTime()));
      return { sid, probs, minTime };
    })
    .sort((a, b) => b.minTime - a.minTime);

  let html = '';

  groupsArray.forEach((group, index) => {
    group.probs.sort((a, b) =>
      new Date(b.timestamp || b.date).getTime() - new Date(a.timestamp || a.date).getTime()
    );

    const date = group.probs[0].date
      || new Date(group.probs[0].timestamp).toLocaleDateString('en-CA');
    const openClass = (index === 0) ? ' open' : '';

    html += `
      <div class="session-group${openClass}">
        <div class="session-header">
          <span>Session ${groupsArray.length - index} · ${date}</span>
          <span class="arrow">▶</span>
        </div>
        <div class="session-content">
          <table>
            <tr><th>#</th><th>Time</th><th>Result</th><th>Mode</th></tr>
            ${group.probs.map(p => {
              const badge = p.result === 'correct' ? 'C' : (p.result === 'incorrect' ? 'I' : 'U');
              const badgeClass = `result-${p.result === 'correct' ? 'c' : (p.result === 'incorrect' ? 'i' : 'u')}`;
              return `
                <tr class="editable-problem" data-problem-id="${p.id}" style="cursor:pointer;">
                  <td>${p.problemNumber || '-'}</td>
                  <td>${formatTime(p.timeSeconds)}</td>
                  <td><span class="${badgeClass}">${badge}</span></td>
                  <td>${p.mode || '-'}</td>
                </tr>
              `;
            }).join('')}
          </table>
        </div>
      </div>
    `;
  });

  const wrap = document.getElementById('subtopicHistoryTableWrap');
  if (wrap) wrap.innerHTML = html;
}

// History panel delegation
document.getElementById('subtopicHistoryTableWrap').addEventListener('click', (e) => {
  const header = e.target.closest('.session-header');
  if (header) {
    header.parentElement.classList.toggle('open');
    return;
  }
  const tr = e.target.closest('.editable-problem');
  if (tr) editProblem(tr.dataset.problemId);
});

// ===================== EDIT PROBLEM =====================
export async function editProblem(id) {
  const problem = await db.sessions.get(id);
  if (!problem) return;

  const modal = document.getElementById('modalProblemDetail');
  const content = document.getElementById('detailContent');
  modal.style.display = 'flex';

  const subject = problem.subject;
  const subtopicId = problem.subtopicId;

  let sections = ['Solved problems', 'Proposed problems'];
  const customSections = await db.bookSections
    .where('subject').equals(subject)
    .and(s => s.book === problem.book)
    .toArray();
  sections = sections.concat(customSections.map(s => s.name));
  if (problem.section && !sections.includes(problem.section)) sections.push(problem.section);

  const topic = state.currentSyllabus.find(t => String(t.id) === subtopicId);
  const books = (topic && Array.isArray(topic.books)) ? topic.books.map(b => b.name) : [];
  if (problem.book && !books.includes(problem.book)) books.push(problem.book);

  let chapters = [];
  const currentBook = problem.book;
  if (topic && currentBook) {
    const bookObj = topic.books?.find(b => b.name === currentBook);
    if (bookObj && Array.isArray(bookObj.chapters)) chapters = bookObj.chapters;
  }
  if (problem.chapter && !chapters.includes(problem.chapter)) chapters.push(problem.chapter);

  content.innerHTML = `
    <div class="grid-2">
      <div><label>Problem #</label><input type="number" id="editProblemNumber" value="${problem.problemNumber || ''}"></div>
      <div><label>Result</label>
        <select id="editResult">
          <option value="correct" ${problem.result === 'correct' ? 'selected' : ''}>Correct</option>
          <option value="incorrect" ${problem.result === 'incorrect' ? 'selected' : ''}>Incorrect</option>
          <option value="unresolved" ${problem.result === 'unresolved' ? 'selected' : ''}>Unresolved</option>
        </select>
      </div>
      <div><label>Time (s)</label><input type="number" step="0.1" id="editTime" value="${problem.timeSeconds || 0}"></div>
      <div><label>Error</label><input type="text" id="editErrorCode" value="${problem.errorCode || ''}"></div>
      <div><label>Confidence</label><input type="number" id="editConfidence" min="1" max="5" value="${problem.confidence || ''}"></div>
      <div><label>Difficulty</label><input type="number" id="editDifficulty" min="1" max="5" value="${problem.perceivedDifficulty || ''}"></div>
      <div><label>Attempts</label><input type="number" id="editAttempts" min="1" value="${problem.attempts || 1}"></div>
      <div><label>Bloom</label><input type="number" id="editBloom" min="1" max="6" value="${problem.bloomLevel || ''}"></div>
      <div><label>Note</label><input type="text" id="editNote" value="${problem.note || ''}"></div>
      <div><label>Section</label>
        <select id="editSection">
          ${sections.map(s => `<option value="${s}" ${problem.section === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div><label>Book</label>
        <select id="editBook">
          ${books.map(b => `<option value="${b}" ${problem.book === b ? 'selected' : ''}>${b}</option>`).join('')}
        </select>
      </div>
      <div><label>Chapter</label>
        <select id="editChapter">
          ${chapters.map(c => `<option value="${c}" ${problem.chapter === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  const btnDelete = document.getElementById('btnDeleteProblem');
  btnDelete.style.display = 'inline-block';
  btnDelete.onclick = async () => {
    if (!confirm('Delete this problem?')) return;
    const userId = state.currentSession?.user?.id;
    const now = new Date().toISOString();

    await db.sessions.delete(id);
    await db.outbox.put({
      table: 'sessions',
      recordId: id,
      operation: 'delete',
      data: { id, userId, deletedAt: now },
      onConflict: 'id',
      createdAt: now
    });
    await syncAll({ silent: true });
    modal.style.display = 'none';
    refreshSubtopicHistory();
    const { refreshAll } = await import('./app.js');
    refreshAll();
  };

  const btnRow = document.querySelector('#modalProblemDetail .btn-row');
  const btnSave = document.createElement('button');
  btnSave.textContent = 'Save changes';
  btnSave.className = 'primary';
  btnSave.id = 'btnSaveEdit';
  btnSave.onclick = async () => {
    const changes = {
      problemNumber: parseInt(document.getElementById('editProblemNumber').value, 10) || 1,
      result: document.getElementById('editResult').value,
      timeSeconds: parseFloat(document.getElementById('editTime').value) || 0,
      errorCode: document.getElementById('editErrorCode').value,
      confidence: parseInt(document.getElementById('editConfidence').value, 10) || null,
      perceivedDifficulty: parseInt(document.getElementById('editDifficulty').value, 10) || null,
      attempts: parseInt(document.getElementById('editAttempts').value, 10) || 1,
      bloomLevel: parseInt(document.getElementById('editBloom').value, 10) || null,
      note: document.getElementById('editNote').value,
      section: document.getElementById('editSection').value,
      book: document.getElementById('editBook').value,
      chapter: document.getElementById('editChapter').value
    };
    await saveLocalAndOutbox('sessions', { ...problem, ...changes }, 'id');
    modal.style.display = 'none';
    refreshSubtopicHistory();
    const { refreshAll } = await import('./app.js');
    refreshAll();
    showToast('Problem updated');
  };

  const existingBtn = document.getElementById('btnSaveEdit');
  if (existingBtn) {
    btnRow.replaceChild(btnSave, existingBtn);
  } else {
    btnRow.insertBefore(btnSave, btnRow.firstChild);
  }
}

// ===================== SESSION CONJECTURES =====================
export async function refreshSessionConjectures() {
  const conjectures = await db.conjectures
    .orderBy('timestamp').reverse().limit(20).toArray();
  const wrap = document.getElementById('sessionConjecturesList');
  if (!wrap) return;

  if (!conjectures.length) {
    wrap.innerHTML = 'No conjectures.';
    return;
  }

  let html = '<table><tr><th>Conjecture</th><th>Subject</th><th>Problem</th><th>Subtopic</th><th>Date</th></tr>';
  conjectures.forEach(c => {
    const d = new Date(c.timestamp);
    html += `<tr><td>${c.text}</td><td>${c.subject || ''}</td><td>${c.problemNumber || ''}</td><td>${c.subtopicId || ''}</td><td>${d.toLocaleTimeString()}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}

// ===================== FSRS =====================
export function createFSRSInstance(weights) {
  return fsrs(generatorParameters({
    request_retention: 0.9,
    enable_short_term: false,
    w: weights
  }));
}

export async function getFrozenWeights(subject) {
  let row = (await db.fsrsWeights.where('subject').equals(subject).toArray())[0];
  if (!row) {
    const id = await saveLocalAndOutbox('fsrsWeights', {
      subject,
      weights: generatorParameters().w,
      frozenDate: new Date().toISOString()
    });
    row = await db.fsrsWeights.get(id);
  }
  return row.weights;
}

export function rebuildCardFromMistake(mistake, lastReview) {
  const stability = Number.isFinite(mistake.fsrsStability) ? mistake.fsrsStability : 0;
  const difficulty = Number.isFinite(mistake.fsrsDifficulty) ? mistake.fsrsDifficulty : 0;
  const reps = Number.isFinite(mistake.fsrsReps) ? mistake.fsrsReps : 0;

  if (reps === 0 || stability <= 0 || difficulty <= 0) {
    return createEmptyCard(lastReview ? new Date(lastReview) : new Date());
  }

  return {
    due: new Date(mistake.nextReview),
    stability,
    difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps,
    lapses: 0,
    state: FSRSState.Review,
    last_review: lastReview ? new Date(lastReview) : undefined
  };
}

async function getLastReview(mistakeId, creationDate) {
  const previous = await db.reviews.where('mistakeId').equals(mistakeId).toArray();
  if (previous.length === 0) return creationDate;
  previous.sort((a, b) => new Date(b.date) - new Date(a.date));
  return previous[0].date;
}

async function updateMistakePartial(mistakeId, changes) {
  const existing = await db.mistakes.get(mistakeId);
  if (!existing) return null;
  return await saveLocalAndOutbox('mistakes', { ...existing, ...changes, id: mistakeId }, 'id');
}

export async function createMistakeFromProblem({
  subject,
  subtopicId,
  subtopicName,
  label,
  phase,
  originProblemId,
  book,
  section
}) {
  await getFrozenWeights(subject);
  const now = new Date();
  const emptyCard = createEmptyCard(now);

  const mistakeId = await saveLocalAndOutbox('mistakes', {
    subject,
    subtopicId,
    subtopicName,
    label,
    originCondition: phase,
    createdDate: now.toISOString(),
    originSessionId: originProblemId,
    status: 'active',
    book: book || null,
    section: section || null,
    fsrsStability: emptyCard.stability,
    fsrsDifficulty: emptyCard.difficulty,
    fsrsReps: emptyCard.reps,
    nextReview: emptyCard.due.toISOString()
  }, 'id');

  return mistakeId;
}

// ===================== RATING (MODE B) =====================
document.getElementById('toggleRating').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleRating .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
});

document.getElementById('btnSaveReview').addEventListener('click', async () => {
  if (!state.selectedMistake) return;

  const ratingBtn = document.querySelector('#toggleRating .toggle-btn.active');
  if (!ratingBtn) {
    showToast('Select a rating.');
    return;
  }
  const rating = ratingBtn.dataset.val === 'correct' ? 3 : 1;

  const g = state.currentRecallGroup;
  const subject = g ? g.subject : document.getElementById('selSubject').value;
  const subtopic = g ? g.subtopicId : document.getElementById('selSubtopic').value;
  const subtopicName = g
    ? g.subtopicName
    : (document.getElementById('selSubtopic').selectedOptions[0]?.textContent || '');
  const book = g ? g.book : document.getElementById('selBook').value;
  const section = g ? g.section : (document.getElementById('selSection')?.value || null);
  const chapter = document.getElementById('selChapter')?.value || null;
  const consultedSolution = document.getElementById('chkConsultedSolution').checked;

  const weights = await getFrozenWeights(subject);
  const f = createFSRSInstance(weights);
  const lastReview = await getLastReview(state.selectedMistake.id, state.selectedMistake.createdDate);
  const rebuiltCard = rebuildCardFromMistake(state.selectedMistake, lastReview);
  const now = new Date();
  const outcome = f.next(rebuiltCard, now, rating);

  await saveLocalAndOutbox('reviews', {
    mistakeId: state.selectedMistake.id,
    date: todayLocal(),
    timestamp: now.toISOString(),
    rating,
    scheduledDays: outcome.log.scheduled_days,
    elapsedDays: outcome.log.elapsed_days,
    recallTimeSeconds: Math.round(state.blindTimer.seconds * 10) / 10,
    consultedSolution,
    stability: outcome.card.stability,
    difficulty: outcome.card.difficulty
  });

  await updateMistakePartial(state.selectedMistake.id, {
    fsrsStability: outcome.card.stability,
    fsrsDifficulty: outcome.card.difficulty,
    fsrsReps: outcome.card.reps,
    nextReview: outcome.card.due.toISOString()
  });

  await saveLocalAndOutbox('sessions', {
    type: 'problem',
    date: todayLocal(),
    timestamp: Date.now(),
    mode: 'B',
    phase: document.getElementById('selPhase').value,
    subject,
    subtopicId: subtopic,
    subtopicName,
    book,
    chapter,
    section,
    timeSeconds: Math.round(state.blindTimer.seconds * 10) / 10,
    result: rating >= 3 ? 'correct' : 'incorrect',
    sessionId: state.session.tempId
  });

  // Reset UI
  document.getElementById('cardResult').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjecture-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleRating .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultedSolution').checked = false;
  state.selectedMistake = null;

  const { populateRecallGroups } = await import('./selectors.js');
  await populateRecallGroups(subject);
  await showPendingMistakes();

  const { refreshMetrics } = await import('./metrics.js');
  const { refreshAll } = await import('./app.js');
  refreshMetrics();
  refreshAll();
  refreshSubtopicHistory();

  document.getElementById('session-conjectures-wrap').style.display = 'block';
  document.getElementById('left-panel').classList.remove('hidden');
  refreshSessionConjectures();

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

document.getElementById('btnDiscardReview').addEventListener('click', async () => {
  document.getElementById('cardResult').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjecture-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleRating .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultedSolution').checked = false;
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