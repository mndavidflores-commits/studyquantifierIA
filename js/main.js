import { supabase } from './config.js';
import { updateAuthUI } from './app.js';

// Side-effect import: registers keyboard/touch/result-button listeners.
import './timer.js';

// Verificación de acceso: solo el dueño puede usar esta app
async function checkOwnerAccess(session) {
  const user = session?.user;
  if (user && user.email !== 'mndavidflores@gmail.com') {
    await supabase.auth.signOut();
    alert('Acceso denegado. Esta aplicación es privada.');
    window.location.reload();
    return false;
  }
  return true;
}

// ===================== INITIAL AUTH CHECK =====================
// If the user already has a Supabase session in localStorage, restore it now.
let session = null;
try {
  const { data } = await supabase.auth.getSession();
  session = data?.session || null;
} catch (e) {
  console.warn('Could not restore auth session:', e);
}

if (await checkOwnerAccess(session)) {
  updateAuthUI(session);
}

// React to future auth changes (login, logout, token refresh).
supabase.auth.onAuthStateChange(async (_event, session) => {
  if (await checkOwnerAccess(session)) {
    updateAuthUI(session);
  }
});

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(registration => {
      // When a new SW version is downloaded, activate it and reload once.
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // A previous SW is still controlling this page — a new one is ready.
            // The new SW calls skipWaiting() on install, so it will activate on
            // the next navigation without needing a forced reload here.
            console.info('New version available — will apply on next reload.');
          }
        });
      });
    })
    .catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
}