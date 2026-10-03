import { db, state } from './config.js';
import { refreshSubtopicHistory, showPendingMistakes } from './reviews.js';
import { todayLocal } from './utils.js';

// ===================== SUBJECT SELECTOR =====================
export async function populateSubjects() {
  const sel = document.getElementById('selSubject');
  if (!sel) return;

  const subjectsDB = await db.subjects.toArray();
  const subjectsSyllabus = [...new Set(state.currentSyllabus.map(t => t.subject))];
  const all = [...new Set([...subjectsSyllabus, ...subjectsDB.map(m => m.name)])];

  sel.innerHTML = '<option value="__add__">+ Add new subject...</option>';
  all.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });

  if (all.length > 0 && sel.options.length > 1) sel.selectedIndex = 1;
  verifyAddSubject();
}

export function verifyAddSubject() {
  const row = document.getElementById('addSubjectRow');
  const sel = document.getElementById('selSubject');
  if (row && sel) row.style.display = (sel.value === '__add__') ? 'flex' : 'none';
}

// ===================== PENDING RECALL COUNTER =====================
async function countRecallsBySubtopic() {
  const today = todayLocal();
  const mistakes = await db.mistakes.where('status').equals('active').toArray();
  const counts = {};
  mistakes.forEach(m => {
    const nextDate = m.nextReview?.split('T')[0];
    if (nextDate && nextDate <= today) {
      const key = m.subtopicId || 'no-subtopic';
      counts[key] = (counts[key] || 0) + 1;
    }
  });
  return counts;
}

// ===================== SUBTOPIC SELECTOR =====================
export async function populateSubtopics(subject) {
  const sel = document.getElementById('selSubtopic');
  if (!sel) return;

  const syllabusTopics = state.currentSyllabus.filter(t => t.subject === subject);
  const extras = await db.extraSubtopics.where('subject').equals(subject).toArray();
  const recallCounts = await countRecallsBySubtopic();

  sel.innerHTML = '<option value="__add__">+ Add new subtopic...</option>';

  const groups = new Map();

  const addToGroup = (stage, item) => {
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage).push(item);
  };

  syllabusTopics.forEach(t => {
    const stage = t.stage || 'Uncategorized';
    addToGroup(stage, { ...t, isExtra: false });
  });
  extras.forEach(e => {
    addToGroup('Custom', { ...e, id: e.id, isExtra: true });
  });

  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === 'Custom') return 1;
    if (b === 'Custom') return -1;
    return a.localeCompare(b);
  });

  for (const stage of groupNames) {
    const items = groups.get(stage);
    if (!items.length) continue;

    const optgroup = document.createElement('optgroup');
    optgroup.label = stage;

    items.forEach(item => {
      const idStr = item.isExtra ? 'extra_' + item.id : String(item.id);
      const pending = recallCounts[idStr] || 0;
      const opt = document.createElement('option');
      opt.value = idStr;
      opt.textContent = pending > 0 ? `${item.name} (${pending})` : item.name;
      optgroup.appendChild(opt);
    });

    sel.appendChild(optgroup);
  }

  verifyAddSubtopic();
}

export function verifyAddSubtopic() {
  const row = document.getElementById('addSubtopicRow');
  const sel = document.getElementById('selSubtopic');
  if (row && sel) row.style.display = (sel.value === '__add__') ? 'flex' : 'none';
}

// ===================== BOOK + CHAPTER SELECTORS =====================
function normalizeBook(book) {
  if (typeof book === 'string') return { name: book, chapters: [] };
  return {
    name: book?.name || 'Untitled book',
    chapters: Array.isArray(book?.chapters) ? book.chapters : []
  };
}

export async function populateBooks(subtopicId) {
  const selBook = document.getElementById('selBook');
  const selChapter = document.getElementById('selChapter');
  if (!selBook || !selChapter) return;

  selBook.innerHTML = '';
  selChapter.innerHTML = '';

  if (!subtopicId || subtopicId === '__add__') {
    selBook.innerHTML = '<option value="">—</option>';
    selChapter.innerHTML = '<option value="">—</option>';
    await populateSections(null, null);
    return;
  }

  let topic = state.currentSyllabus.find(t => String(t.id) === subtopicId);
  if (!topic && subtopicId.startsWith('extra_')) {
    const extraId = subtopicId.replace('extra_', '');
    const extra = await db.extraSubtopics.get(extraId);
    if (extra) topic = { name: extra.name, books: [] };
  }

  const rawBooks = Array.isArray(topic?.books) ? topic.books : [];
  const books = rawBooks.map(normalizeBook);

  if (!books.length) {
    selBook.innerHTML = '<option value="">No book</option>';
    selChapter.innerHTML = '<option value="">No chapter</option>';
    await populateSections(null, null);
    return;
  }

  selBook.innerHTML = books.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
  updateChapters(books[0].name, subtopicId);

  const subject = document.getElementById('selSubject')?.value;
  await populateSections(subject, books[0].name);
}

export function updateChapters(selectedBook, subtopicId) {
  const selChapter = document.getElementById('selChapter');
  if (!selChapter) return;
  selChapter.innerHTML = '';

  if (!subtopicId || !selectedBook || subtopicId === '__add__') {
    selChapter.innerHTML = '<option value="">—</option>';
    return;
  }

  const topic = state.currentSyllabus.find(t => String(t.id) === subtopicId);
  const rawBook = topic?.books?.find(b => (typeof b === 'string' ? b : b.name) === selectedBook);
  const book = rawBook ? normalizeBook(rawBook) : null;

  if (book && book.chapters.length) {
    selChapter.innerHTML = book.chapters.map(c => `<option value="${c}">${c}</option>`).join('');
  } else {
    selChapter.innerHTML = '<option value="">No chapter</option>';
  }
}

// ===================== SECTION SELECTOR =====================
export async function populateSections(subject, book) {
  const sel = document.getElementById('selSection');
  const addRow = document.getElementById('addSectionRow');
  if (!sel) return;

  sel.innerHTML = '';

  if (!subject || !book) {
    sel.innerHTML = '<option value="">—</option>';
    if (addRow) addRow.style.display = 'none';
    return;
  }

  const baseSections = ['Solved problems', 'Proposed problems'];
  baseSections.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  const custom = await db.bookSections
    .where('subject').equals(subject)
    .and(s => s.book === book)
    .toArray();

  custom.forEach(section => {
    const opt = document.createElement('option');
    opt.value = section.name;
    opt.textContent = section.name;
    sel.appendChild(opt);
  });

  const optAdd = document.createElement('option');
  optAdd.value = '__add__';
  optAdd.textContent = '+ Add new section...';
  sel.appendChild(optAdd);

  sel.value = baseSections[0];
  if (addRow) addRow.style.display = 'none';
  verifyAddSection();

  const activeView = document.getElementById('active-view');
  if (activeView && activeView.classList.contains('active')) {
    await refreshSubtopicHistory();
  }
}

export function verifyAddSection() {
  const sel = document.getElementById('selSection');
  const row = document.getElementById('addSectionRow');
  if (sel && row) row.style.display = (sel.value === '__add__') ? 'flex' : 'none';
}

// ===================== RECALL GROUPS (MODE B) — Anki-style list =====================
/**
 * Builds a scrollable list of clickable groups instead of a <select> dropdown.
 * Each item is a div.recall-group-item with data-key and data-count.
 * The selected item gets the .active class.
 */
export async function populateRecallGroups(subject) {
  const list = document.getElementById('recallGroupList');
  if (!list) return;

  // Placeholder while empty / unselected
  list.innerHTML = '<div class="recall-group-item disabled">Select a recall group...</div>';
  if (!subject || subject === '__add__') return;

  const today = todayLocal();
  const mistakes = await db.mistakes.where('status').equals('active').toArray();
  const pending = mistakes.filter(m => {
    if (m.subject !== subject) return false;
    const nextDate = m.nextReview?.split('T')[0];
    return nextDate && nextDate <= today;
  });

  const groups = new Map();

  for (const m of pending) {
    const book = m.book || 'No book';
    const section = m.section || 'No section';
    const subtopicId = m.subtopicId || 'no-subtopic';
    const key = `${subject}|${book}|${subtopicId}|${section}`;

    if (!groups.has(key)) {
      groups.set(key, {
        subject,
        book,
        subtopicId,
        section,
        subtopicName: m.subtopicName || subtopicId,
        count: 0
      });
    }
    groups.get(key).count++;
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.subtopicName !== b.subtopicName) return a.subtopicName.localeCompare(b.subtopicName);
    return a.section.localeCompare(b.section);
  });

  if (sorted.length === 0) {
    list.innerHTML = '<div class="recall-group-item disabled">No pending recalls for this subject</div>';
    return;
  }

  list.innerHTML = '';

  const activeKey = state.currentRecallGroup
    ? `${state.currentRecallGroup.subject}|${state.currentRecallGroup.book}|${state.currentRecallGroup.subtopicId}|${state.currentRecallGroup.section}`
    : '';

  for (const g of sorted) {
    const key = `${g.subject}|${g.book}|${g.subtopicId}|${g.section}`;
    const item = document.createElement('div');
    item.className = 'recall-group-item' + (key === activeKey ? ' active' : '');
    item.dataset.key = key;
    item.dataset.count = g.count;

    // textContent auto-escapes — safe against any special characters in user data.
    const label = document.createElement('span');
    label.className = 'recall-group-label';
    label.textContent = `${g.book} · ${g.subtopicName} · ${g.section}`;

    const count = document.createElement('span');
    count.className = 'recall-group-count';
    count.textContent = g.count;

    item.appendChild(label);
    item.appendChild(count);
    list.appendChild(item);
  }

  // Ensure the active item is scrolled into view (if any)
  const active = list.querySelector('.recall-group-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

// ===================== APPLY RECALL GROUP =====================
export async function applyRecallGroup(key) {
  if (!key) {
    state.currentRecallGroup = null;
    const el = document.getElementById('nombreSubtopicHistory');
    if (el) el.textContent = '—';
    return;
  }

  const [subject, book, subtopicId, section] = key.split('|');

  let subtopicName = subtopicId;
  if (subtopicId.startsWith('extra_')) {
    const extraId = subtopicId.replace('extra_', '');
    const extra = await db.extraSubtopics.get(extraId);
    subtopicName = extra?.name || subtopicId;
  } else {
    const topic = state.currentSyllabus.find(t => String(t.id) === subtopicId);
    subtopicName = topic?.name || subtopicId;
  }

  state.currentRecallGroup = {
    subject,
    book,
    subtopicId,
    section,
    subtopicName
  };

  const nameEl = document.getElementById('nombreSubtopicHistory');
  if (nameEl) nameEl.textContent = subtopicName;

  // Keep hidden selectors in sync so downstream code reading .value still works.
  const selSubject = document.getElementById('selSubject');
  const selSubtopic = document.getElementById('selSubtopic');
  const selBook = document.getElementById('selBook');
  const selSection = document.getElementById('selSection');

  if (selSubject && selSubject.value !== subject) selSubject.value = subject;

  if (selSubtopic) {
    for (const opt of selSubtopic.options) {
      if (opt.value === subtopicId) { selSubtopic.value = subtopicId; break; }
    }
  }
  if (selBook) {
    for (const opt of selBook.options) {
      if (opt.value === book) { selBook.value = book; break; }
    }
  }
  if (selSection) {
    for (const opt of selSection.options) {
      if (opt.value === section) { selSection.value = section; break; }
    }
  }

  await showPendingMistakes();
  await refreshSubtopicHistory();
}