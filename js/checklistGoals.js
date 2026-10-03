import { db, state } from './config.js';
import { saveLocalAndOutbox, syncAll } from './sync.js';
import { todayLocal, formatDate } from './utils.js';

// ===================== HIERARCHICAL CHECKLIST =====================
export async function refreshChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  try {
    const completed = await db.checklist.toArray();
    const completedMap = new Map();
    completed.forEach(c => {
      const key = `${c.type}:${c.subtopicId || ''}:${c.book || ''}:${c.chapter || ''}`;
      completedMap.set(key, c);
    });

    function formatChapter(chapter) {
      const text = String(chapter);
      if (/^\d+$/.test(text)) return `Chapter ${text}`;
      if (/^\d+:\s*(.+)/.test(text) || /^\d+\s+(.+)/.test(text)) return `Chapter ${text}`;
      return text;
    }

    let total = 0;
    let completedCount = 0;
    const fragment = document.createDocumentFragment();
    const subjects = [...new Set(state.currentSyllabus.map(t => t.subject))];

    for (const subject of subjects) {
      const topics = state.currentSyllabus.filter(t => t.subject === subject);
      if (!topics.length) continue;

      const subjectDiv = document.createElement('div');
      subjectDiv.textContent = subject;
      subjectDiv.style.fontWeight = 'bold';
      subjectDiv.style.fontSize = '1.3rem';
      subjectDiv.style.marginTop = '10px';
      subjectDiv.style.paddingBottom = '4px';
      subjectDiv.style.borderBottom = '1px solid var(--border)';
      subjectDiv.style.color = '#fff';
      fragment.appendChild(subjectDiv);

      for (const topic of topics) {
        const subtopicId = (topic.id != null ? topic.id.toString() : 'no-id');
        const subtopicName = topic.name || `Subtopic ${subtopicId}`;

        // ----- Subtopic row -----
        const labelSubtopic = document.createElement('label');
        labelSubtopic.style.display = 'flex';
        labelSubtopic.style.alignItems = 'center';
        labelSubtopic.style.gap = '8px';
        labelSubtopic.style.padding = '8px 0';
        labelSubtopic.style.borderBottom = '1px solid var(--border)';
        labelSubtopic.style.fontSize = '1.2rem';
        labelSubtopic.style.fontFamily = 'var(--mono)';
        labelSubtopic.style.color = 'var(--text)';

        const inputSubtopic = document.createElement('input');
        inputSubtopic.type = 'checkbox';
        inputSubtopic.className = 'checklist-cb';
        inputSubtopic.dataset.type = 'subtopic';
        inputSubtopic.dataset.subject = subject;
        inputSubtopic.dataset.subtopic = subtopicId;
        inputSubtopic.style.width = '20px';
        inputSubtopic.style.height = '20px';
        inputSubtopic.style.accentColor = 'var(--accent)';

        const keySubtopic = `subtopic:${subtopicId}::`;
        if (completedMap.has(keySubtopic)) {
          inputSubtopic.checked = true;
          completedCount++;
        }
        total++;

        labelSubtopic.appendChild(inputSubtopic);
        labelSubtopic.appendChild(document.createTextNode(subtopicName));
        fragment.appendChild(labelSubtopic);

        // ----- Books -----
        const books = Array.isArray(topic.books) ? topic.books : [];

        for (const rawBook of books) {
          const bookName = typeof rawBook === 'string'
            ? rawBook
            : (rawBook.name || 'Untitled book');
          const chapters = (rawBook && Array.isArray(rawBook.chapters)) ? rawBook.chapters : [];

          const labelBook = document.createElement('label');
          labelBook.style.display = 'flex';
          labelBook.style.alignItems = 'center';
          labelBook.style.gap = '8px';
          labelBook.style.padding = '8px 0';
          labelBook.style.paddingLeft = '20px';
          labelBook.style.borderBottom = '1px solid var(--border)';
          labelBook.style.fontSize = '1.2rem';
          labelBook.style.fontFamily = 'var(--mono)';
          labelBook.style.color = 'var(--text)';

          const inputBook = document.createElement('input');
          inputBook.type = 'checkbox';
          inputBook.className = 'checklist-cb';
          inputBook.dataset.type = 'book';
          inputBook.dataset.subject = subject;
          inputBook.dataset.subtopic = subtopicId;
          inputBook.dataset.book = bookName;
          inputBook.style.width = '20px';
          inputBook.style.height = '20px';
          inputBook.style.accentColor = 'var(--accent)';

          const keyBook = `book:${subtopicId}:${bookName}:`;
          if (completedMap.has(keyBook)) {
            inputBook.checked = true;
            completedCount++;
          }
          total++;

          labelBook.appendChild(inputBook);
          labelBook.appendChild(document.createTextNode('📖 ' + bookName));
          fragment.appendChild(labelBook);

          // ----- Chapters -----
          for (const chapter of chapters) {
            const chapterLabel = formatChapter(chapter);
            const labelChapter = document.createElement('label');
            labelChapter.style.display = 'flex';
            labelChapter.style.alignItems = 'center';
            labelChapter.style.gap = '8px';
            labelChapter.style.padding = '8px 0';
            labelChapter.style.paddingLeft = '40px';
            labelChapter.style.borderBottom = '1px solid var(--border)';
            labelChapter.style.fontSize = '1.2rem';
            labelChapter.style.fontFamily = 'var(--mono)';
            labelChapter.style.color = 'var(--text)';

            const inputChapter = document.createElement('input');
            inputChapter.type = 'checkbox';
            inputChapter.className = 'checklist-cb';
            inputChapter.dataset.type = 'chapter';
            inputChapter.dataset.subject = subject;
            inputChapter.dataset.subtopic = subtopicId;
            inputChapter.dataset.book = bookName;
            inputChapter.dataset.chapter = chapter;
            inputChapter.style.width = '20px';
            inputChapter.style.height = '20px';
            inputChapter.style.accentColor = 'var(--accent)';

            const keyChapter = `chapter:${subtopicId}:${bookName}:${chapter}`;
            if (completedMap.has(keyChapter)) {
              inputChapter.checked = true;
              completedCount++;
            }
            total++;

            labelChapter.appendChild(inputChapter);
            labelChapter.appendChild(document.createTextNode(chapterLabel));
            fragment.appendChild(labelChapter);
          }
        }
      }
    }

    container.innerHTML = '';
    container.appendChild(fragment);

    const pct = total ? Math.round(completedCount / total * 100) : 0;
    document.getElementById('progressChecklist').style.width = pct + '%';
    document.getElementById('checklistPercent').textContent = `${pct}% completed (${completedCount}/${total})`;
  } catch (error) {
    console.error('Error in refreshChecklist:', error);
    container.innerHTML = '<p style="color:var(--text2);">Failed to load the checklist.</p>';
  }
}

// ===================== CHECKBOX EVENT DELEGATION =====================
const checklistContainer = document.getElementById('checklistContainer');
if (checklistContainer) {
  checklistContainer.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('checklist-cb')) return;

    const type = e.target.dataset.type;
    const subject = e.target.dataset.subject;
    const subtopicId = e.target.dataset.subtopic;
    const book = e.target.dataset.book || null;
    const chapter = e.target.dataset.chapter || null;

    const records = await db.checklist.where('subtopicId').equals(subtopicId).toArray();
    const existing = records.find(r =>
      r.type === type &&
      (r.book || '') === (book || '') &&
      (r.chapter || '') === (chapter || '')
    );

    if (e.target.checked) {
      if (!existing) {
        await saveLocalAndOutbox('checklist', {
          type,
          subject,
          subtopicId,
          book,
          chapter,
          completed: true
        }, 'id');
      } else {
        await saveLocalAndOutbox('checklist', {
          ...existing,
          completed: true
        }, 'id');
      }
    } else {
      if (existing) {
        await db.checklist.delete(existing.id);
        await db.outbox.put({
          table: 'checklist',
          recordId: existing.id,
          operation: 'delete',
          data: {
            id: existing.id,
            userId: state.currentSession?.user?.id,
            deletedAt: new Date().toISOString()
          },
          onConflict: 'id',
          createdAt: new Date().toISOString()
        });
        await syncAll({ silent: true });
      }
    }

    refreshChecklist();
  });
}

// ===================== GOALS =====================
export async function refreshGoals() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isActiveDay = state.activeGoalDays.includes(dayOfWeek);

  // --- Daily ---
  const todaySessions = await db.sessions
    .where('date').equals(todayLocal())
    .and(s => s.type === 'pomodoro')
    .toArray();

  const hoursToday = todaySessions.reduce((a, s) => a + (s.pomodoroTime || 0), 0) / 3600;
  const dailyGoalEl = document.getElementById('dailyGoal');
  const dailyGoal = parseFloat(dailyGoalEl?.value) || 3;

  if (isActiveDay) {
    document.getElementById('dailyProgress').textContent = `${hoursToday.toFixed(1)}h / ${dailyGoal}h`;
    document.getElementById('dailyProgressBar').style.width =
      Math.min(100, (hoursToday / dailyGoal) * 100) + '%';
  } else {
    document.getElementById('dailyProgress').textContent = `${hoursToday.toFixed(1)}h (inactive day)`;
    document.getElementById('dailyProgressBar').style.width = '0%';
  }

  // --- Weekly ---
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  const startOfWeekStr = formatDate(startOfWeek);
  const todayStr = todayLocal();

  const weekSessions = await db.sessions
    .where('date').between(startOfWeekStr, todayStr, true, true)
    .and(s => s.type === 'pomodoro')
    .toArray();

  const hoursThisWeek = weekSessions.reduce((a, s) => a + (s.pomodoroTime || 0), 0) / 3600;
  const weeklyGoalEl = document.getElementById('weeklyGoal');
  const weeklyGoal = parseFloat(weeklyGoalEl?.value) || 15;

  document.getElementById('weeklyProgress').textContent =
    `${hoursThisWeek.toFixed(1)}h / ${weeklyGoal}h`;
  document.getElementById('weeklyProgressBar').style.width =
    Math.min(100, (hoursThisWeek / weeklyGoal) * 100) + '%';
}