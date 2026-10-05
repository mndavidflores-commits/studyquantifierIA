import { supabase } from './config.js';
import { updateAuthUI } from './app.js';

// Side-effect import: registers keyboard/touch/result-button listeners.
import './timer.js';

// ===================== CONFIG =====================
const OWNER_EMAIL = 'mndavidflores@gmail.com';

// ===================== HELPERS =====================
function rehydrateLucide() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// ===================== OWNER CHECK =====================
/**
 * Signs out any session whose email is not the owner's, and shows an alert
 * only once per tab (sessionStorage guard) so a stale token can't cause an
 * infinite reload loop.
 */
async function checkOwnerAccess(session) {
  const user = session?.user;
  if (!user) return true;
  if (user.email === OWNER_EMAIL) return true;

  await supabase.auth.signOut();

  if (!sessionStorage.getItem('owner-check-done')) {
    sessionStorage.setItem('owner-check-done', '1');
    alert('Access denied. This application is private.');
  }
  return false;
}

// ===================== AUTH RESOLUTION =====================
async function resolveAuth(session) {
  const allowed = await checkOwnerAccess(session);
  if (!allowed) {
    updateAuthUI(null);
    rehydrateLucide();
    return;
  }
  updateAuthUI(session);
  rehydrateLucide();
}

// ===================== INITIAL AUTH CHECK =====================
let session = null;
try {
  const { data } = await supabase.auth.getSession();
  session = data?.session || null;
} catch (e) {
  console.warn('Could not restore auth session:', e);
}

await resolveAuth(session);

// React to future auth changes (login, logout, token refresh).
supabase.auth.onAuthStateChange((_event, session) => {
  resolveAuth(session);
});

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(registration => {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('New version available — will apply on next reload.');
          }
        });
      });
    })
    .catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
}