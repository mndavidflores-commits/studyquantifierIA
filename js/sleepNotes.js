import { db, state } from './config.js';
import { showToast } from './utils.js';
import { syncAll } from './sync.js';
import { refreshSleepChart } from './charts.js';

// Re-export for compatibility with other modules
export { refreshSleepChart };

// ===================== HOURS CALCULATION =====================
/**
 * Calculates the number of hours between two "HH:MM" time strings.
 * Handles cross-midnight (e.g. 23:00 → 07:00 = 8 hours).
 */
export function calculateHours(bedtime, wakeup) {
  if (!bedtime || !wakeup) return 0;
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wakeup.split(':').map(Number);
  let minutes = (wh * 60 + wm) - (bh * 60 + bm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round(minutes / 60 * 10) / 10;
}

// ===================== SLEEP HISTORY =====================
export async function refreshSleepHistory() {
  const wrap = document.getElementById('sleepHistoryTable');
  if (!wrap) return;

  const records = await db.sleep.orderBy('date').reverse().limit(50).toArray();

  if (!records.length) {
    wrap.innerHTML = '<p style="color:var(--text2);">No sleep records.</p>';
    return;
  }

  function format12h(time24) {
    if (!time24) return '-';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  let html = `<table>
    <thead>
      <tr><th>Date</th><th>Hours</th><th>Quality</th><th>Bedtime</th><th>Wake up</th><th></th></tr>
    </thead>
    <tbody>`;

  records.forEach(r => {
    const stars = '★'.repeat(Math.floor(r.quality)) + '☆'.repeat(10 - Math.floor(r.quality));
    html += `<tr>
      <td>${r.date}</td>
      <td>${r.hours}h</td>
      <td>${stars} ${r.quality}/10</td>
      <td>${format12h(r.bedtime)}</td>
      <td>${format12h(r.wakeup)}</td>
      <td><button class="small danger" data-delete-sleep="${r.id}">X</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-delete-sleep]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteSleep;
      const userId = state.currentSession?.user?.id;
      if (!userId) return;

      await db.sleep.delete(id);
      await db.outbox.put({
        table: 'sleep',
        recordId: id,
        operation: 'delete',
        data: { id, userId, deletedAt: new Date().toISOString() },
        onConflict: 'id',
        createdAt: new Date().toISOString()
      });

      showToast('Sleep record deleted ✅');
      await syncAll({ silent: true });
      refreshSleepHistory();
      refreshSleepChart();
    });
  });
}

// ===================== NOTES =====================
export async function refreshNotes() {
  const wrap = document.getElementById('notesList');
  if (!wrap) return;

  const problems = await db.sessions.where('type').equals('problem').toArray();
  const notes = problems.filter(p => p.mode === 'A' && p.note && p.note.trim() !== '');

  const selSubject = document.getElementById('notesFilterSubject');
  const selSubtopic = document.getElementById('notesFilterSubtopic');
  const selChapter = document.getElementById('notesFilterChapter');

  // ---- Subject filter ----
  if (selSubject) {
    const syllabusSubjects = [...new Set(state.currentSyllabus.map(t => t.subject))];
    const dbSubjects = await db.subjects.toArray();
    const allSubjects = [...new Set([...syllabusSubjects, ...dbSubjects.map(s => s.name)])];

    const previousSubject = selSubject.value || 'All';
    selSubject.innerHTML = '<option value="All">All</option>'
      + allSubjects.map(s => `<option value="${s}">${s}</option>`).join('');

    // If the previous value no longer exists, fall back to "All"
    const subjectExists = [...selSubject.options].some(o => o.value === previousSubject);
    selSubject.value = subjectExists ? previousSubject : 'All';
  }

  // ---- Subtopic filter ----
  if (selSubtopic) {
    const selectedSubject = selSubject.value !== 'All' ? selSubject.value : null;
    const subtopics = [];

    if (selectedSubject) {
      const topics = state.currentSyllabus.filter(t => t.subject === selectedSubject);
      const extras = await db.extraSubtopics.where('subject').equals(selectedSubject).toArray();
      subtopics.push(...topics.map(t => ({ id: String(t.id), name: t.name })));
      subtopics.push(...extras.map(e => ({ id: 'extra_' + e.id, name: e.name })));
    } else {
      const topics = state.currentSyllabus;
      const extras = await db.extraSubtopics.toArray();
      subtopics.push(...topics.map(t => ({ id: String(t.id), name: t.name })));
      subtopics.push(...extras.map(e => ({ id: 'extra_' + e.id, name: e.name })));
    }

    const previousSubtopic = selSubtopic.value || 'All';
    selSubtopic.innerHTML = '<option value="All">All</option>'
      + subtopics.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

    const subtopicExists = [...selSubtopic.options].some(o => o.value === previousSubtopic);
    selSubtopic.value = subtopicExists ? previousSubtopic : 'All';
  }

  // ---- Chapter filter ----
  if (selChapter) {
    const chapters = new Set();
    notes.forEach(n => { if (n.chapter) chapters.add(n.chapter); });

    const previousChapter = selChapter.value || 'All';
    selChapter.innerHTML = '<option value="All">All</option>'
      + [...chapters].map(c => `<option value="${c}">${c}</option>`).join('');

    const chapterExists = [...selChapter.options].some(o => o.value === previousChapter);
    selChapter.value = chapterExists ? previousChapter : 'All';
  }

  // ---- Apply filters ----
  const filtered = notes.filter(n => {
    if (selSubject && selSubject.value !== 'All' && n.subject !== selSubject.value) return false;
    if (selSubtopic && selSubtopic.value !== 'All' && n.subtopicId !== selSubtopic.value) return false;
    if (selChapter && selChapter.value !== 'All' && n.chapter !== selChapter.value) return false;
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = '<p style="color:var(--text2);">No notes.</p>';
    return;
  }

  let html = '<table><tr><th>Subject</th><th>Subtopic</th><th>Problem</th><th>Chapter</th><th>Note</th></tr>';
  filtered.forEach(n => {
    html += `<tr>
      <td>${n.subject || ''}</td>
      <td>${n.subtopicName || n.subtopicId || ''}</td>
      <td>${n.problemNumber || '-'}</td>
      <td>${n.chapter || '-'}</td>
      <td>${n.note}</td>
    </tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}