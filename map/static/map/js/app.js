// =============================================================================
// MF Maps — entry point
// =============================================================================

import { fetchAuthState, initAuth, setAuthChangeHandler } from './auth.js';
import {
    initMap,
    initLayerPanels,
    wireFabs,
    initQueryMode,
    initGeolocate,
    initModeTabs,
} from './map-setup.js';
import {
    wireMapClicks,
    initObservationForms,
    startObservation,
    loadObservations,
} from './observations.js';

async function main() {
    // 1. Initialize the map and wait for its 'load' event
    await initMap();

    // 2. Wire UI that depends on the map being ready
    initLayerPanels();
    initQueryMode();
    initGeolocate();
    wireMapClicks();
    wireFabs(startObservation);
    initModeTabs(loadObservations);

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