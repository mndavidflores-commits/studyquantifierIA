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

supabase.auth.onAuthStateChange((_event, session) => {
  resolveAuth(session);
});

// ===================== SERVICE WORKER =====================
// The SW's cache-first strategy is great for the installed PWA in
// production, but it makes the dev cycle painful (every CSS/JS change
// requires Ctrl+Shift+R). So:
//
//   - On localhost / 127.0.0.1 / LAN IPs → don't register. Also
//     unregister any SW left over from previous dev sessions.
//   - Everywhere else (Netlify, custom domains) → register normally.
const isLocalDev =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname.startsWith('192.168.') ||
  location.hostname.endsWith('.local');

if ('serviceWorker' in navigator) {
  if (isLocalDev) {
    // Clean up any SW from earlier sessions so no stale cache lingers.
    navigator.serviceWorker.getRegistrations()
      .then(regs => {
        regs.forEach(r => r.unregister());
        if (regs.length > 0) {
          console.info(`[dev] Unregistered ${regs.length} service worker(s).`);
        }
      })
      .catch(() => { /* ignore */ });

    // Also clear all caches from those SWs.
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }
  } else {
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
}