// =============================================================================
// Shared state across modules
// =============================================================================

export const state = {
    // The MapLibre map instance, populated by map-setup.js after init
    map: null,

    // The MapLibre GeolocateControl instance
    geolocate: null,

    // Currently logged-in user, populated by auth.js after fetchAuthState()
    // Shape: { email, id } when logged in, null otherwise
    currentUser: null,

    // Whether the cursor is in "query mode" (next click reads features)
    queryMode: false,

    // The currently open MapLibre Popup, so we can close before opening another
    openPopup: null,
};

// Layer group → list of MapLibre layer IDs
// Used by layer toggles to flip visibility on groups of related layers.
export const LAYER_IDS = {
    'observations': ['observations-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line'],
    'hydrography': [
        'nhd-streams',
        'nhd-streams-label',
        'nhd-waterbodies-fill',
        'nhd-waterbodies-stroke',
        'nhd-waterbodies-label',
        'nhd-areas-fill',
        'nhd-areas-stroke'
    ],
};

// H3 resolution for "where am I" + demo aggregation
export const H3_RES = 8;