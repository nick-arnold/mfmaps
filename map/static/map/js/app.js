// =============================================================================
// MF Maps — entry point
// =============================================================================

import { state, loadTreeSpeciesSelection } from './state.js';
import { fetchAuthState, initAuth, setAuthChangeHandler } from './auth.js';
import { initSpeciesPicker } from './species-picker.js';
import {
    initMap,
    initLayerPanels,
    wireFabs,
    initQueryMode,
    initGeolocate,
    initModeTabs,
    initCrosshair,
    initBurnSeverityControls,
} from './map-setup.js';
import {
    wireMapClicks,
    initObservationForms,
    startObservation,
    loadObservations,
} from './observations.js';
import { loadReports } from './reports.js';

// Force a full reload if the page was restored from bfcache. Otherwise
// Chrome may serve stale in-memory JS from a previous session.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        window.location.reload();
    }
});

async function forceRefresh() {
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
    } catch (err) {
        console.warn('Cache/SW clear failed:', err);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now());
    window.location.href = url.toString();
}

function wireRefreshButtons() {
    document.querySelectorAll('.refresh-app-btn').forEach(btn => {
        btn.addEventListener('click', forceRefresh);
    });
}

async function main() {
    // Restore any previously-selected species from localStorage
    state.treeSpeciesSelection = loadTreeSpeciesSelection();

    if (new URL(window.location.href).searchParams.has('_r')) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('_r');
        window.history.replaceState({}, '', cleanUrl.toString());
    }

    // 1. Initialize the map and wait for its 'load' event
    await initMap();

    // DEBUG: expose map and state to the console for poking around
    window.map = state.map;
    window.state = state;

    // 2. Wire UI that depends on the map being ready
    initLayerPanels();
    initSpeciesPicker();
    initBurnSeverityControls();
    initQueryMode();
    initGeolocate();
    initCrosshair();
    wireMapClicks();
    wireFabs(startObservation);
    initModeTabs(loadObservations, loadReports);

    // 3. Auth forms and account menus
    initAuth();
    initObservationForms();
    wireRefreshButtons();

    // 4. When the user logs in or out, reload the observations layer
    setAuthChangeHandler(() => {
        loadObservations();
    });

    // 5. Check auth state, then load observations if signed in
    await fetchAuthState();
    if (window.__currentUser !== undefined) {
        // no-op; placeholder for future logic
    }
    loadObservations();
}

main();