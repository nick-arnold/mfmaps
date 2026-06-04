// =============================================================================
// Shared state across modules
// =============================================================================

export const state = {
    map: null,
    geolocate: null,
    currentUser: null,
    queryMode: false,
    openPopup: null,
};

export const LAYER_IDS = {
    'observations': ['observations-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line'],
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
        'hawaii-z11-12-hillshade'
    ],
    'hydrography': [
        'nhd-streams',
        'nhd-streams-label-large',
        'nhd-streams-label-medium',
        'nhd-streams-label-small',
        'nhd-waterbodies-fill',
        'nhd-waterbodies-stroke',
        'nhd-waterbodies-label',
        'nhd-areas-fill',
        'nhd-areas-stroke'
    ],
    'nhd_ak': [
        'nhd-ak-streams',
        'nhd-ak-waterbodies-fill',
        'nhd-ak-waterbodies-stroke',
        'nhd-ak-streams-label-high',
        'nhd-ak-streams-label-mid',
        'nhd-ak-streams-label-low',
        'nhd-ak-waterbodies-label'
    ],
    'nhd_conus': [
        'nhd-conus-streams',
        'nhd-conus-waterbodies-fill',
        'nhd-conus-waterbodies-stroke',
        'nhd-conus-streams-label-large',
        'nhd-conus-streams-label-medium',
        'nhd-conus-streams-label-small',
        'nhd-conus-waterbodies-label'
    ],
};

export const H3_RES = 8;