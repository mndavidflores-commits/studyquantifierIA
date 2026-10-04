import { db, supabase, state } from './config.js';
import { showToast } from './utils.js';

// ===================== SYNC STATE =====================
let syncTimeout = null;
let syncInProgress = false;

// Tables that participate in bidirectional sync.
// `syllabus` is intentionally excluded — it lives only on the local device.
const SYNCED_TABLES = [
  'sessions',
  'conjectures',
  'sleep',
  'subjects',
  'extraSubtopics',
  'goals',
  'mistakes',
  'reviews',
  'fsrsWeights',
  'topicMastery',
  'bookSections',
  'checklist'
];

// Tables that don't have an `id` column on the server.
// `goals` uses a composite natural key (userId, key).
const TABLES_WITHOUT_ID = new Set(['goals']);

// Returns the primary key field used for tombstone deletion.
function primaryKeyFor(table) {
  if (table === 'goals') return 'key';
  return 'id';
}

// ===================== DEBOUNCED SYNC =====================
function scheduleSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncAll({ silent: true });
  }, 1500);
}

// ===================== PUSH (local → Supabase) =====================
export async function pushChanges({ silent = false } = {}) {
  if (state.currentSession?.user?.id === 'local-guest-user') {
    return;
  }
  const ops = await db.outbox.toArray();
  if (ops.length === 0) {
    if (!silent) showToast('Nothing pending to sync', 2000);
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const op of ops) {
    let error;

    if (op.operation === 'delete') {
      const keys = (op.onConflict || 'id').split(',').map(k => k.trim());
      let query = supabase.from(op.table).update({
        deletedAt: op.data.deletedAt || new Date().toISOString()
      });
      keys.forEach(k => { query = query.eq(k, op.data[k]); });
      ({ error } = await query);
    } else {
      const payload = { ...op.data };
      if (TABLES_WITHOUT_ID.has(op.table)) {
        delete payload.id;
      }
      ({ error } = await supabase
        .from(op.table)
        .upsert(payload, { onConflict: op.onConflict || 'id' }));
    }

    if (!error) {
      await db.outbox.delete(op.localId);
      sent++;
    } else {
      console.error('Sync error:', error, 'Details:', error?.message, error?.details, error?.hint);
      failed++;
    }
  }

  if (!silent) {
    const suffix = failed ? ` Failed: ${failed}` : '';
    showToast(`Synced: ${sent} records.${suffix}`, 3000);
  }
}

// ===================== PULL (Supabase → local) =====================
export async function pullChanges() {
  const userId = state.currentSession?.user?.id;
  if (!userId || userId === 'local-guest-user') return;

  for (const table of SYNCED_TABLES) {
    const cursorKey = `lastPull_${table}`;
    const cursorRow = await db.syncMetadata.get(cursorKey);
    const lastPull = cursorRow?.value || new Date(0).toISOString();

    const { data: rows, error } = await supabase
      .from(table)
      .select('*')
      .eq('userId', userId)
      .gt('updatedAt', lastPull);

    if (error) {
      // Do NOT advance the cursor on error — we'll retry on the next pull.
      console.warn(`Pull failed for ${table}:`, error.message);
      continue;
    }

    if (!rows || rows.length === 0) continue;

    const collection = db[table];
    if (!collection) continue;

    const active = rows.filter(r => !r.deletedAt);
    const deleted = rows.filter(r => r.deletedAt);

    if (active.length > 0) {
      await collection.bulkPut(active);
    }
    if (deleted.length > 0) {
      const pk = primaryKeyFor(table);
      await collection.bulkDelete(deleted.map(r => r[pk]));
    }

    // Advance the cursor to the newest updatedAt we received (not "now()").
    const maxUpdatedAt = rows.reduce(
      (max, r) => (r.updatedAt && r.updatedAt > max) ? r.updatedAt : max,
      lastPull
    );
    await db.syncMetadata.put({ key: cursorKey, value: maxUpdatedAt });
  }
}

// ===================== SYNC ALL =====================
export async function syncAll({ silent = false } = {}) {
  if (!state.currentSession?.user) return;
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    await pushChanges({ silent });
    await pullChanges();
  } finally {
    syncInProgress = false;
  }
}

// ===================== SAVE LOCAL + QUEUE OUTBOX =====================
/**
 * Writes a record to the local Dexie collection and queues it in the outbox
 * for the next push.
 *
 * For tables that DO have an `id` column, a UUID is generated (or reused from
 * `data.id`) and used as the record's primary key and outbox `recordId`.
 *
 * For tables WITHOUT an `id` column (see TABLES_WITHOUT_ID), the natural key
 * (`data.key`) is used as the outbox `recordId` and no `id` field is written
 * to the local record. This avoids generating throwaway UUIDs that would
 * never reach the server and could shadow each other in the outbox.
 *
 * @param {string} collection - Dexie collection name (identical to the Supabase table name)
 * @param {object} data - Record data
 * @param {string} onConflict - Supabase onConflict clause (e.g. "id", "userId,key")
 * @returns {Promise<string|null>} The record id (or natural key), or null if not authenticated
 */
export async function saveLocalAndOutbox(collection, data, onConflict = 'id') {
  if (!state.currentSession?.user) return null;

  const isKeyBased = TABLES_WITHOUT_ID.has(collection);

  const id = data.id || crypto.randomUUID();
  const recordId = isKeyBased ? data.key : id;

  const existing = isKeyBased
    ? await db[collection].get(data.key)
    : (data.id ? await db[collection].get(id) : null);

  const record = {
    ...data,
    userId: state.currentSession.user.id,
    createdAt: existing?.createdAt || data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };

  // Only tables that actually have an `id` column should carry one locally.
  if (!isKeyBased) {
    record.id = id;
  }

  await db[collection].put(record);

  // Build the payload for the outbox — strip `id` for key-based tables in
  // case any caller accidentally passed one in.
  const payload = { ...record };
  if (isKeyBased) {
    delete payload.id;
  }

  await db.outbox.put({
    table: collection,
    recordId,
    operation: 'insert',
    data: payload,
    onConflict,
    createdAt: new Date().toISOString()
  });

  scheduleSync();
  return recordId;
}

// ===================== FIX SESSION ID =====================
/**
 * After a pomodoro session is created with a real UUID, update all child
 * records (problems + conjectures) that were linked to the temporary session id.
 *
 * Before enqueuing the updated versions, any pending outbox entries for these
 * records are removed — otherwise the server would receive both the old and
 * new payloads for the same rows, briefly creating duplicate state.
 */
export async function fixSessionId(tempId, realSessionId) {
  if (!state.currentSession?.user) return;
  const userId = state.currentSession.user.id;
  const now = new Date().toISOString();

  const problems = await db.sessions.where('sessionId').equals(tempId).toArray();
  const conjectures = await db.conjectures.where('sessionId').equals(tempId).toArray();

  // Drop any queued ops for these records before queuing the corrected versions.
  const staleIds = [
    ...problems.map(p => p.id),
    ...conjectures.map(c => c.id)
  ];
  if (staleIds.length > 0) {
    await db.outbox.where('recordId').anyOf(staleIds).delete();
  }

  await db.sessions.where('sessionId').equals(tempId).modify({ sessionId: realSessionId });
  for (const p of problems) {
    await db.outbox.put({
      table: 'sessions',
      recordId: p.id,
      operation: 'insert',
      data: { ...p, sessionId: realSessionId, userId, updatedAt: now },
      onConflict: 'id',
      createdAt: now
    });
  }

  await db.conjectures.where('sessionId').equals(tempId).modify({ sessionId: realSessionId });
  for (const c of conjectures) {
    await db.outbox.put({
      table: 'conjectures',
      recordId: c.id,
      operation: 'insert',
      data: { ...c, sessionId: realSessionId, userId, updatedAt: now },
      onConflict: 'id',
      createdAt: now
    });
  }

  scheduleSync();
}