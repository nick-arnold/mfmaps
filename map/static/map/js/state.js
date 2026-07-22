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

    // Burn severity: currently displayed year (single-select). null = none.
    burnSeverityYear: null,
    // Burn severity perimeter toggle (independent of raster year)
    burnSeverityPerimeterVisible: false,
    
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

// Burn severity year persistence
const BURN_SEVERITY_YEAR_KEY = 'mfmaps-burn-severity-year';
const BURN_SEVERITY_PERIM_KEY = 'mfmaps-burn-severity-perimeter';

export function loadBurnSeverityYear() {
    try {
        const raw = localStorage.getItem(BURN_SEVERITY_YEAR_KEY);
        if (!raw) return null;
        const n = parseInt(raw, 10);
        return isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

export function saveBurnSeverityYear(year) {
    try {
        if (year == null) {
            localStorage.removeItem(BURN_SEVERITY_YEAR_KEY);
        } else {
            localStorage.setItem(BURN_SEVERITY_YEAR_KEY, String(year));
        }
    } catch {
        // Ignore
    }
}

export function loadBurnSeverityPerimeterVisible() {
    try {
        return localStorage.getItem(BURN_SEVERITY_PERIM_KEY) === '1';
    } catch {
        return false;
    }
}

export function saveBurnSeverityPerimeterVisible(visible) {
    try {
        localStorage.setItem(BURN_SEVERITY_PERIM_KEY, visible ? '1' : '0');
    } catch {
        // Ignore
    }
}





// All burn severity display layer IDs — generated to match sources.
// Kept flat here so LAYER_IDS['burn-severity'] can toggle the whole group
// (used by setLayerGroupVisibility when the main group is turned off).
const BURN_SEVERITY_YEARS = {
    conus: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
    ak:    [2020, 2021, 2022, 2023, 2024],
    hi:    [2021, 2022, 2023, 2024],
};

function buildBurnSeverityLayerIds() {
    const ids = [];
    for (const [region, years] of Object.entries(BURN_SEVERITY_YEARS)) {
        for (const y of years) {
            ids.push(`burn-severity-${region}-${y}-layer`);
        }
    }
    return ids;
}

export const BURN_SEVERITY_REGIONS = BURN_SEVERITY_YEARS;

// All unique years across regions, sorted descending (most recent first)
export const BURN_SEVERITY_ALL_YEARS = (() => {
    const s = new Set();
    Object.values(BURN_SEVERITY_YEARS).forEach(arr => arr.forEach(y => s.add(y)));
    return [...s].sort((a, b) => b - a);
})();

export const LAYER_IDS = {
    observations: ['observations-layer'],
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
    contour: (() => {
        const regions = ['conus', 'alaska', 'hawaii'];
        const zoomTiers = [10, 11, 12, 13];
        const ids = [];
        regions.forEach(region => {
            zoomTiers.forEach(z => {
                ids.push(`contour-intermediate-${region}-z${z}`);
                ids.push(`contour-index-${region}-z${z}`);
            });
        });
        return ids;
    })(),
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
    // Burn severity: raster layers per region/year (managed together;
    // the main toggle turns the whole group off, the year dropdown picks
    // which single year is visible when the group is on)
    'burn-severity': buildBurnSeverityLayerIds(),
    // Perimeter is toggled independently
    'burn-severity-perimeter': ['burn-severity-perimeters-line'],

    'soil-moisture-raster': ['soil-moisture-raster-layer'],
    'soil-moisture-isolines': ['soil-moisture-isolines-layer'],
};

export const H3_RES = 8;