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

async function main() {
    // Restore any previously-selected species from localStorage
    state.treeSpeciesSelection = loadTreeSpeciesSelection();

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