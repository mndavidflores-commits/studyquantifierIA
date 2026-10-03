import { updateAuthUI, initApp } from './auth.js';
import { refreshAll, refreshActivePanels } from './panels.js';
import { initEvents } from './events.js';

// ===================== RE-EXPORTS =====================
// `main.js` imports `updateAuthUI` from this module for the initial
// Supabase session check. Everything else that other modules need to reach
// dynamically (`refreshAll`, etc.) is also re-exported here.
export { updateAuthUI, initApp, refreshAll, refreshActivePanels };

// ===================== BOOT =====================
// Wire up all global event listeners as soon as this module is evaluated.
// `main.js` is loaded with `<script type="module">` at the end of the body,
// so the DOM is fully parsed by the time this runs.
initEvents();

// NOTE: Service Worker registration lives in `main.js` — do not duplicate it here.