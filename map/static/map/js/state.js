// =============================================================================
// Shared state across modules
// =============================================================================

export const state = {
    map: null,
    geolocate: null,
    currentUser: null,
    queryMode: false,
    crosshairMode: false,
    openPopup: null,

    // Tree species legends, loaded once at startup, keyed by region name.
    // Each value is a Map from code (as number) to { name, hex, rgb }.
    treeSpeciesLegends: {},
    
    // Tree species picker: Set of "region:code" strings (e.g. "conus:201")
    // Empty set = no filter, show all species with their default colors
    treeSpeciesSelection: new Set(),
};

// localStorage helpers for species selection persistence
const SPECIES_SELECTION_KEY = 'mfmaps-tree-species-selection';

export function loadTreeSpeciesSelection() {
    try {
        const raw = localStorage.getItem(SPECIES_SELECTION_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

export function saveTreeSpeciesSelection(selection) {
    try {
        localStorage.setItem(SPECIES_SELECTION_KEY, JSON.stringify([...selection]));
    } catch {
        // Ignore quota errors
    }
}

export const LAYER_IDS = {
    observations: ['observations-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line'],
    canopy: ['canopy-conus-layer', 'canopy-seak-layer', 'canopy-hawaii-layer'],
    trails: [
        'trails-track',
        'trails-bridleway',
        'trails-cycleway',
        'trails-footway-real',
        'trails-path-unknown',
        'trails-path-natural',
    ],
    terrain: [
        'terrain-z3-4-hillshade',
        'terrain-z5-7-hillshade',
        'terrain-z8-10-hillshade',
        'terrain-z11-12-hillshade',
        'alaska-z3-4-hillshade',
        'alaska-z5-7-hillshade',
        'alaska-z8-10-hillshade',
        'alaska-z11-12-hillshade',
        'hawaii-z3-4-hillshade',
        'hawaii-z5-7-hillshade',
        'hawaii-z8-10-hillshade',
        'hawaii-z11-12-hillshade',
    ],
    hydrography: [
        // CONUS + Hawaii
        'nhd-conus-streams',
        'nhd-conus-waterbodies-fill',
        'nhd-conus-waterbodies-stroke',
        // Alaska
        'nhd-ak-streams',
        'nhd-ak-waterbodies-fill',
        'nhd-ak-waterbodies-stroke',
        // Labels — AK
        'nhd-ak-streams-label-high',
        'nhd-ak-streams-label-mid',
        'nhd-ak-streams-label-low',
        'nhd-ak-waterbodies-label',
        // Labels — CONUS (legacy Protomaps source; remove if nhd source is gone)
        'nhd-streams-label-large',
        'nhd-streams-label-medium',
        'nhd-streams-label-small',
        'nhd-waterbodies-label',
        // Selected/hover overlays are intentionally excluded —
        // they're driven by interaction, not the visibility toggle
    ],
    slope: [
        'slope-conus-layer',
        'slope-alaska-layer',
        'slope-hawaii-layer'
    ],
    aspect: [
        'aspect-conus-layer',
        'aspect-alaska-layer',
        'aspect-hawaii-layer'
    ],
    'tree-species': [
        'tree-species-layer',
        'tree-species-ak-layer',
        'tree-species-hi-layer',
    ],
};

export const H3_RES = 8;