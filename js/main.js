import { supabase } from './config.js';
import { updateAuthUI } from './app.js';

// Side-effect import: registers keyboard/touch/result-button listeners.
import './timer.js';

// ===================== CONFIG =====================
const OWNER_EMAIL = 'mndavidflores@gmail.com';
const GUEST_FLAG = 'studyquantifier_guest';
const GUEST_SESSION = {
  user: { id: 'local-guest-user', email: 'guest@studyquantifier.local' }
};

// ===================== AUTH RESOLUTION =====================
/**
 * Decides which UI to show based on:
 *   (a) any real Supabase session, and
 *   (b) the local guest flag in localStorage.
 *
 * Called on boot and on every auth state change. Safe to call multiple times.
 */
async function resolveAuth(session) {
  const user = session?.user;

  // ---- 1) Real Supabase session ----
  if (user) {
    // Owner: clear any stale guest flag and proceed.
    if (user.email === OWNER_EMAIL) {
      localStorage.removeItem(GUEST_FLAG);
      sessionStorage.removeItem('owner-check-done');
      updateAuthUI(session);
      return;
    }

    // Non-owner: app is currently owner-only. Sign out.
    // Show the alert only ONCE per tab, otherwise a bad token would cause
    // an infinite alert → reload loop.
    await supabase.auth.signOut();
    localStorage.removeItem(GUEST_FLAG);

    if (!sessionStorage.getItem('owner-check-done')) {
      sessionStorage.setItem('owner-check-done', '1');
      alert('Acceso denegado. Esta aplicación es privada.');
    }
    updateAuthUI(null);
    return;
  }

  // ---- 2) No Supabase session: is the user a guest? ----
  if (localStorage.getItem(GUEST_FLAG) === 'true') {
    updateAuthUI(GUEST_SESSION);
    return;
  }

  // ---- 3) Nothing: signed out, not a guest ----
  updateAuthUI(null);
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