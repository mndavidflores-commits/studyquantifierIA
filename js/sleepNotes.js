import { db, state } from './config.js';
import { showToast, escapeHtml } from './utils.js';
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
    wrap.innerHTML = '<p style="color:var(--paper-mute);">No sleep records.</p>';
    return;
  }

  function format12h(time24) {
    if (!time24) return '-';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function starsHtml(quality) {
    const filled = Math.floor(quality);
    const empty = 10 - filled;
    return `<span style="color:var(--accent)">${'★'.repeat(filled)}</span>` +
           `<span style="color:var(--paper-faint)">${'☆'.repeat(empty)}</span>`;
  }

  let html = `<table>
    <thead>
      <tr><th>Date</th><th>Hours</th><th>Quality</th><th>Bedtime</th><th>Wake up</th><th></th></tr>
    </thead>
    <tbody>`;

  records.forEach(r => {
    html += `<tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${r.hours}h</td>
      <td>${starsHtml(r.quality)} ${r.quality}/10</td>
      <td>${format12h(r.bedtime)}</td>
      <td>${format12h(r.wakeup)}</td>
      <td>
        <button class="icon-btn" data-delete-sleep="${r.id}" title="Delete" aria-label="Delete">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  // Hydrate the newly-injected Lucide icons.
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }

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

  // Capture current filter values before rebuilding the selects.
  const currentSubject = selSubject?.value || 'All';
  const currentSubtopic = selSubtopic?.value || 'All';
  const currentChapter = selChapter?.value || 'All';

  // ---- Subject filter ----
  if (selSubject) {
    const syllabusSubjects = [...new Set(state.currentSyllabus.map(t => t.subject))];
    const dbSubjects = await db.subjects.toArray();
    const allSubjects = [...new Set([...syllabusSubjects, ...dbSubjects.map(s => s.name)])];

    selSubject.innerHTML = '<option value="All">All</option>'
      + allSubjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    const exists = [...selSubject.options].some(o => o.value === currentSubject);
    selSubject.value = exists ? currentSubject : 'All';
  }

  const effectiveSubject = selSubject?.value || 'All';

  // ---- Subtopic filter ----
  if (selSubtopic) {
    const subtopics = [];

    if (effectiveSubject !== 'All') {
      const topics = state.currentSyllabus.filter(t => t.subject === effectiveSubject);
      const extras = await db.extraSubtopics.where('subject').equals(effectiveSubject).toArray();
      subtopics.push(...topics.map(t => ({ id: String(t.id), name: t.name })));
      subtopics.push(...extras.map(e => ({ id: 'extra_' + e.id, name: e.name })));
    } else {
      const topics = state.currentSyllabus;
      const extras = await db.extraSubtopics.toArray();
      subtopics.push(...topics.map(t => ({ id: String(t.id), name: t.name })));
      subtopics.push(...extras.map(e => ({ id: 'extra_' + e.id, name: e.name })));
    }

    selSubtopic.innerHTML = '<option value="All">All</option>'
      + subtopics.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');

    const exists = [...selSubtopic.options].some(o => o.value === currentSubtopic);
    selSubtopic.value = exists ? currentSubtopic : 'All';
  }

  const effectiveSubtopic = selSubtopic?.value || 'All';

  // ---- Chapter filter (only chapters present in notes matching subject+subtopic) ----
  if (selChapter) {
    const chapters = new Set();
    notes.forEach(n => {
      if (effectiveSubject !== 'All' && n.subject !== effectiveSubject) return;
      if (effectiveSubtopic !== 'All' && n.subtopicId !== effectiveSubtopic) return;
      if (n.chapter) chapters.add(n.chapter);
    });

    selChapter.innerHTML = '<option value="All">All</option>'
      + [...chapters].sort().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    const exists = [...selChapter.options].some(o => o.value === currentChapter);
    selChapter.value = exists ? currentChapter : 'All';
  }

  // ---- Apply filters ----
  const filterSubject = selSubject?.value || 'All';
  const filterSubtopic = selSubtopic?.value || 'All';
  const filterChapter = selChapter?.value || 'All';

  const filtered = notes.filter(n => {
    if (filterSubject !== 'All' && n.subject !== filterSubject) return false;
    if (filterSubtopic !== 'All' && n.subtopicId !== filterSubtopic) return false;
    if (filterChapter !== 'All' && n.chapter !== filterChapter) return false;
    return true;
  });

  if (!filtered.length) {
    wrap.innerHTML = '<p style="color:var(--paper-mute);">No notes.</p>';
    return;
  }

  let html = '<table><tr><th>Subject</th><th>Subtopic</th><th>Problem</th><th>Chapter</th><th>Note</th></tr>';
  filtered.forEach(n => {
    html += `<tr>
      <td>${escapeHtml(n.subject || '')}</td>
      <td>${escapeHtml(n.subtopicName || n.subtopicId || '')}</td>
      <td>${n.problemNumber ?? '-'}</td>
      <td>${escapeHtml(n.chapter || '-')}</td>
      <td>${escapeHtml(n.note)}</td>
    </tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}