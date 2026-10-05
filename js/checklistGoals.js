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

      // ----- Subject header -----
      const subjectDiv = document.createElement('div');
      subjectDiv.textContent = subject;
      subjectDiv.style.fontFamily = 'var(--font-display)';
      subjectDiv.style.fontWeight = '700';
      subjectDiv.style.fontSize = '1.15rem';
      subjectDiv.style.letterSpacing = '-0.01em';
      subjectDiv.style.marginTop = 'var(--space-md)';
      subjectDiv.style.paddingBottom = 'var(--space-xs)';
      subjectDiv.style.borderBottom = '1px solid var(--ink-border)';
      subjectDiv.style.color = 'var(--paper)';
      fragment.appendChild(subjectDiv);

      for (const topic of topics) {
        const subtopicId = (topic.id != null ? topic.id.toString() : 'no-id');
        const subtopicName = topic.name || `Subtopic ${subtopicId}`;

        // ----- Subtopic row -----
        const labelSubtopic = document.createElement('label');
        labelSubtopic.style.fontFamily = 'var(--font-body)';
        labelSubtopic.style.fontWeight = '600';
        labelSubtopic.style.fontSize = '1rem';
        labelSubtopic.style.color = 'var(--paper)';

        const inputSubtopic = document.createElement('input');
        inputSubtopic.type = 'checkbox';
        inputSubtopic.className = 'checklist-cb';
        inputSubtopic.dataset.type = 'subtopic';
        inputSubtopic.dataset.subject = subject;
        inputSubtopic.dataset.subtopic = subtopicId;

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
          labelBook.style.paddingLeft = '20px';
          labelBook.style.fontFamily = 'var(--font-body)';
          labelBook.style.fontWeight = '400';
          labelBook.style.fontSize = '0.95rem';
          labelBook.style.color = 'var(--paper-soft)';

          const inputBook = document.createElement('input');
          inputBook.type = 'checkbox';
          inputBook.className = 'checklist-cb';
          inputBook.dataset.type = 'book';
          inputBook.dataset.subject = subject;
          inputBook.dataset.subtopic = subtopicId;
          inputBook.dataset.book = bookName;

          const keyBook = `book:${subtopicId}:${bookName}:`;
          if (completedMap.has(keyBook)) {
            inputBook.checked = true;
            completedCount++;
          }
          total++;

          labelBook.appendChild(inputBook);
          labelBook.appendChild(document.createTextNode(bookName));
          fragment.appendChild(labelBook);

          // ----- Chapters -----
          for (const chapter of chapters) {
            const chapterLabel = formatChapter(chapter);
            const labelChapter = document.createElement('label');
            labelChapter.style.paddingLeft = '40px';
            labelChapter.style.fontFamily = 'var(--font-body)';
            labelChapter.style.fontWeight = '400';
            labelChapter.style.fontSize = '0.9rem';
            labelChapter.style.color = 'var(--paper-mute)';

            const inputChapter = document.createElement('input');
            inputChapter.type = 'checkbox';
            inputChapter.className = 'checklist-cb';
            inputChapter.dataset.type = 'chapter';
            inputChapter.dataset.subject = subject;
            inputChapter.dataset.subtopic = subtopicId;
            inputChapter.dataset.book = bookName;
            inputChapter.dataset.chapter = chapter;

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

    // === GOAL GRADIENT (video 3) ===
    // Instead of always saying "0% completed" (deflating), reframe
    // the percent line based on where the user actually is.
    const pct = total ? Math.round(completedCount / total * 100) : 0;
    const percentEl = document.getElementById('checklistPercent');
    document.getElementById('progressChecklist').style.width = pct + '%';

    if (percentEl) {
      if (completedCount === 0) {
        // Never started: don't punish with 0%. Invite.
        percentEl.textContent = `Ready to begin — your first topic unlocks progress`;
      } else if (completedCount === total) {
        // Finished everything.
        percentEl.textContent = `All done — ${completedCount} of ${total} topics ✓`;
      } else {
        // In progress: goal-gradient framing.
        const remaining = total - completedCount;
        percentEl.textContent = `${pct}% completed · ${completedCount}/${total} · ${remaining} to go`;
      }
    }
  } catch (error) {
    console.error('Error in refreshChecklist:', error);
    container.innerHTML = '<p style="color:var(--paper-mute);">Failed to load the checklist.</p>';
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
/**
 * Goals panel with two psychological reframes from video 3:
 *
 *   1. Contrast effect — never show "today" in isolation. Always
 *      contextualize against a 7-day average so the user can feel
 *      whether they're ahead or behind.
 *
 *   2. Goal gradient — when the user has never studied, don't start
 *      them at "0%". Reframe the empty state as an invitation and
 *      give them the sense that step 1 is already underway.
 */
export async function refreshGoals() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const isActiveDay = state.activeGoalDays.includes(dayOfWeek);

  // ---- Daily hours (today) ----
  const todaySessions = await db.sessions
    .where('date').equals(todayLocal())
    .and(s => s.type === 'pomodoro')
    .toArray();

  const hoursToday = todaySessions.reduce((a, s) => a + (s.pomodoroTime || 0), 0) / 3600;
  const dailyGoalEl = document.getElementById('dailyGoal');
  const dailyGoal = parseFloat(dailyGoalEl?.value) || 3;

  // ---- Contrast baseline: 7-day average (excluding today) ----
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = formatDate(sevenDaysAgo);

  const last7Sessions = await db.sessions
    .where('date').between(sevenDaysAgoStr, todayLocal(), true, false)
    .and(s => s.type === 'pomodoro')
    .toArray();

  const hoursByDay = {};
  last7Sessions.forEach(s => {
    const d = s.date;
    hoursByDay[d] = (hoursByDay[d] || 0) + (s.pomodoroTime || 0) / 3600;
  });
  const daysWithData = Object.keys(hoursByDay).length;
  const weeklyAvg = daysWithData > 0
    ? Object.values(hoursByDay).reduce((a, b) => a + b, 0) / daysWithData
    : 0;

  // ---- Daily progress with contextual message ----
  const dailyProgressEl = document.getElementById('dailyProgress');
  const dailyProgressBarEl = document.getElementById('dailyProgressBar');

  if (!dailyProgressEl || !dailyProgressBarEl) {
    // Fallback: silently exit if the elements aren't in the DOM yet.
    return;
  }

  if (!isActiveDay) {
    // Rest day
    if (hoursToday > 0) {
      dailyProgressEl.textContent = `${hoursToday.toFixed(1)}h (rest day — bonus)`;
    } else {
      dailyProgressEl.textContent = `Rest day — no goal today`;
    }
    dailyProgressBarEl.style.width = '0%';
  } else if (hoursToday === 0 && weeklyAvg === 0) {
    // First time ever — goal gradient: don't start at 0%
    dailyProgressEl.textContent = `Ready to begin — your first session sets the baseline`;
    dailyProgressBarEl.style.width = '0%';
  } else if (hoursToday >= dailyGoal) {
    // Goal reached — celebrate with the overflow
    const overflow = (hoursToday - dailyGoal).toFixed(1);
    dailyProgressEl.textContent = `${hoursToday.toFixed(1)}h / ${dailyGoal}h ✓ +${overflow}h over`;
    dailyProgressBarEl.style.width = '100%';
  } else {
    // In progress — contrast against the 7-day average
    const pct = Math.min(100, (hoursToday / dailyGoal) * 100);
    const diff = hoursToday - weeklyAvg;
    let contrast = '';
    if (weeklyAvg > 0) {
      if (diff >= 0) {
        contrast = ` — above your ${weeklyAvg.toFixed(1)}h avg`;
      } else {
        contrast = ` — ${Math.abs(diff).toFixed(1)}h below your ${weeklyAvg.toFixed(1)}h avg`;
      }
    }
    dailyProgressEl.textContent = `${hoursToday.toFixed(1)}h / ${dailyGoal}h${contrast}`;
    dailyProgressBarEl.style.width = pct + '%';
  }

  // ---- Weekly hours ----
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

  // Days remaining in the week (including today) — used to compute
  // how many hours per day the user needs to hit the weekly goal.
  const daysIntoWeek = ((now.getDay() + 6) % 7) + 1; // Mon=1 ... Sun=7
  const daysRemaining = Math.max(1, 7 - daysIntoWeek + 1);
  const perDayNeeded = Math.max(0, (weeklyGoal - hoursThisWeek) / daysRemaining);

  const weeklyProgressEl = document.getElementById('weeklyProgress');
  const weeklyProgressBarEl = document.getElementById('weeklyProgressBar');

  if (!weeklyProgressEl || !weeklyProgressBarEl) return;

  if (hoursThisWeek >= weeklyGoal) {
    weeklyProgressEl.textContent = `${hoursThisWeek.toFixed(1)}h / ${weeklyGoal}h ✓ weekly goal reached`;
    weeklyProgressBarEl.style.width = '100%';
  } else if (hoursThisWeek === 0) {
    // Goal gradient for weekly too
    weeklyProgressEl.textContent = `${weeklyGoal}h target — pace: ${(weeklyGoal / 7).toFixed(1)}h/day`;
    weeklyProgressBarEl.style.width = '0%';
  } else {
    weeklyProgressEl.textContent = `${hoursThisWeek.toFixed(1)}h / ${weeklyGoal}h — ${perDayNeeded.toFixed(1)}h/day to hit target`;
    weeklyProgressBarEl.style.width = Math.min(100, (hoursThisWeek / weeklyGoal) * 100) + '%';
  }
}