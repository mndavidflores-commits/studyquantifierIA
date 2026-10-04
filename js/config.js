import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';

export const SUPABASE_URL = 'https://wrtmlucrxzewynnnikzh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qJcUe3t_K5Yl0m7lkV3C_A_5bcdtOFs';
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
window.supabase = supabase;

export const db = new Dexie('StudyquantifierDB');
window.db = db;

// ===================== SCHEMA =====================
db.version(1).stores({
  sessions:       'id, updatedAt, sessionId, type, date, timestamp',
  conjectures:    'id, updatedAt, sessionId, timestamp, subject',
  sleep:          'id, updatedAt, date',
  subjects:       'id, name, updatedAt',
  extraSubtopics: 'id, subject, name, updatedAt',
  goals:          'key, updatedAt',
  outbox:         '++localId, table, recordId, operation, data, createdAt',
  syncMetadata:   'key',
  mistakes:       'id, updatedAt, subject, subtopicId, status, nextReview',
  reviews:        'id, updatedAt, mistakeId, date',
  fsrsWeights:    'id, updatedAt, subject',
  topicMastery:   'id, updatedAt, subject, subtopicId',
  syllabus:       'key',
  bookSections:   'id, subject, book, name, updatedAt',
  checklist:      'id, updatedAt, userId, subject, subtopicId, book, chapter, type, completed'
});

// ===================== POMODORO STATE ENUM =====================
export const PomodoroState = {
  IDLE: 'IDLE',
  FOCUS_RUNNING: 'FOCUS_RUNNING',
  FOCUS_PAUSED: 'FOCUS_PAUSED',
  BREAK_RUNNING: 'BREAK_RUNNING',
  BREAK_PAUSED: 'BREAK_PAUSED',
  SESSION_ENDING: 'SESSION_ENDING'
};

// ===================== GLOBAL STATE =====================
export const state = {
  session: {
    state: PomodoroState.IDLE,
    tempId: null,
    savedSessionId: null,          // id of the session after autoSaveSession()
    mode: null,
    remainingSeconds: 90 * 60,
    elapsedTotal: 0,               // seconds in the CURRENT phase (focus or break)
    totalFocusSeconds: 0,          // accumulated focus seconds across all focus phases in this session
    finalFocusSeconds: 0,          // frozen at SESSION_ENDING, used for the summary
    distractions: 0,
    readingSeconds: 0,
    readingRunning: false,
    readingInterval: null,
    pomoInterval: null,
    pendingSessionEnd: false,
    pomodoroMode: 'countdown',     // 'countdown' | 'timer'
    pomoStartTime: null
  },

  blindTimer: {
    running: false,
    seconds: 0,
    interval: null,
    startTime: null,               // Date.now() when the current run began
    wasRunning: false,             // set when paused mid-run, used to resume
    paused: false,                 // true while the timer is frozen but not discarded
    pendingResult: false,
    previousProblemNumber: 1
  },

  currentProblemNumber: 1,
  currentSession: null,
  selectedMistake: null,
  pendingMistakes: [],
  currentRecallGroup: null,

  currentSyllabus: [
    { id: 1, subject: 'Algebra', stage: 'A1', name: 'Equations' },
    { id: 2, subject: 'Algebra', stage: 'B1', name: 'Polynomials' }
  ],

  // Chart.js instances
  chartTime: null,
  chartRadar: null,
  chartEvolution: null,
  chartProblems: null,
  chartFSRS: null,

  selectedChartSubject: 'Mathematics',
  showAvg10: true,
  showPointsA: true,
  showPointsB: true,

  activeGoalDays: [1, 2, 3, 4, 5, 6, 0],
  appInitialized: false
};

// Expose state globally for debugging
window.state = state;