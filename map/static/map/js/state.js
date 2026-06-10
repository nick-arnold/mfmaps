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
    canopy: ['canopy-conus-layer', 'canopy-seak-layer', 'canopy-hawaii-layer'], 
    'trails': [
        'trails-track',           // forest roads / doubletracks
        'trails-bridleway',       // equestrian routes
        'trails-cycleway',        // dedicated bike paths
        'trails-footway-real',    // park paths / greenways (non-sidewalk, natural surface)
        'trails-path-unknown',    // singletrack, no surface tag
        'trails-path-natural',    // singletrack, confirmed natural surface
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
        'hawaii-z11-12-hillshade'
    ],
    'hydrography': [
        // Protomaps labels
        'nhd-streams-label-large',
        'nhd-streams-label-medium',
        'nhd-streams-label-small',
        'nhd-waterbodies-label',
        // AK
        'nhd-ak-streams',
        'nhd-ak-waterbodies-fill',
        'nhd-ak-waterbodies-stroke',
        'nhd-ak-streams-label-high',
        'nhd-ak-streams-label-mid',
        'nhd-ak-streams-label-low',
        'nhd-ak-waterbodies-label',
        // CONUS
        'nhd-conus-streams',
        'nhd-conus-waterbodies-fill',
        'nhd-conus-waterbodies-stroke'
    ]
};

export const H3_RES = 8;