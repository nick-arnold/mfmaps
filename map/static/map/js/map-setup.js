// =============================================================================
// Map initialization, sources/layers, geolocation, query mode, mode tabs
// =============================================================================

import { state, LAYER_IDS, H3_RES } from './state.js';
import { escapeHtml } from './api.js';

const US_BOUNDS = [
    [-125.0, 24.5],
    [-66.5, 49.5]
];



// Shared color palette
const STREAM_COLOR   = '#2e6f96';
const WATER_FILL     = '#9ecbe0';
const LABEL_HALO     = '#ffffff';
const LABEL_FONT     = ['Noto Sans Italic'];
const HOVER_COLOR    = '#ffb300';
const SELECTED_COLOR = '#ff7a1a';

// Contour palette (shared across all region/zoom tiers)
const CONTOUR_INTERMEDIATE_COLOR = '#9a7b4f';
const CONTOUR_INDEX_COLOR        = '#7a5f3a';

// --- URL hash <-> map state ----------------------------------------------
//
// Format: #z/lat/lng   e.g.  #11.5/44.0531/-122.8642
// On load, if a valid hash is present the map opens there; otherwise it falls
// back to US_BOUNDS. As the user pans/zooms, the hash is rewritten on moveend
// using replaceState (no history spam, back button still leaves the app).

function parseUrlHash() {
    const h = window.location.hash;
    if (!h || h.length < 2) return null;

    const parts = h.slice(1).split('/');
    if (parts.length !== 3) return null;

    const zoom = parseFloat(parts[0]);
    const lat  = parseFloat(parts[1]);
    const lng  = parseFloat(parts[2]);

    if (!isFinite(zoom) || !isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90) return null;
    if (lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 24) return null;

    return { zoom, lat, lng };
}

function wireUrlSync() {
    const update = () => {
        const c = state.map.getCenter();
        const z = state.map.getZoom();
        const hash = `#${z.toFixed(1)}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`;
        window.history.replaceState(null, '', hash);
    };

    state.map.on('moveend', update);
    update();
}

// --- Map init -------------------------------------------------------------

export function initMap() {
    if (!state._pmtilesRegistered) {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        state._pmtilesRegistered = true;
    }

    const hashState = parseUrlHash();

    const mapOpts = {
        container: 'map',
        style: window.MFMAPS_STYLE_URL || '/static/map/styles/bright-mfmaps.json',
    };

    if (hashState) {
        mapOpts.center = [hashState.lng, hashState.lat];
        mapOpts.zoom = hashState.zoom;
    } else {
        mapOpts.bounds = US_BOUNDS;
        mapOpts.fitBoundsOptions = { padding: 40 };
    }

    state.map = new maplibregl.Map(mapOpts);

    state.geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true
    });
    state.map.addControl(state.geolocate, 'top-right');
    state.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    return new Promise((resolve) => {
        state.map.on('load', () => {
            addSourcesAndLayers();
            wireHydroInteractions();
            wireTreeSpeciesHover();
            wireUrlSync();
            resolve();
        });
    });
}

// --- Sources and layers ---------------------------------------------------

function addSourcesAndLayers() {
    const { map } = state;
    const empty = { type: 'FeatureCollection', features: [] };

    const BASEMAP_LINE_ANCHOR = 'tunnel-service-track-casing';

    // --- Terrain hillshade (CONUS) ------------------------------------
    const TERRAIN_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/terrain';

    const terrainTiers = [
        { id: 'terrain-z3-4',   file: 'conus_z3-4.pmtiles',   minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'terrain-z5-7',   file: 'conus_z5-7.pmtiles',   minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'terrain-z8-10',  file: 'conus_z8-10.pmtiles',  minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'terrain-z11-12', file: 'conus_z11-12.pmtiles', minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 },
        { id: 'alaska-z3-4',    file: 'alaska_z3-4.pmtiles',  minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'alaska-z5-7',    file: 'alaska_z5-7.pmtiles',  minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'alaska-z8-10',   file: 'alaska_z8-10.pmtiles', minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'alaska-z11-12',  file: 'alaska_z11-12.pmtiles',minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 },
        { id: 'hawaii-z3-4',    file: 'hawaii_z3-4.pmtiles',  minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'hawaii-z5-7',    file: 'hawaii_z5-7.pmtiles',  minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'hawaii-z8-10',   file: 'hawaii_z8-10.pmtiles', minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'hawaii-z11-12',  file: 'hawaii_z11-12.pmtiles',minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 }
    ];

    terrainTiers.forEach(tier => {
        map.addSource(tier.id, {
            type: 'raster-dem',
            url: `pmtiles://${TERRAIN_BASE}/${tier.file}`,
            encoding: 'mapbox',
            tileSize: 512,
            maxzoom: tier.sourceMaxzoom
        });
        map.addLayer({
            id: `${tier.id}-hillshade`,
            type: 'hillshade',
            source: tier.id,
            minzoom: tier.minzoom,
            maxzoom: tier.maxzoom,
            paint: {
                'hillshade-method': 'combined',
                'hillshade-shadow-color': '#3a2a18',
                'hillshade-highlight-color': 'rgba(0,0,0,0)',
                'hillshade-accent-color': 'rgba(0,0,0,0)',
                'hillshade-exaggeration': 0.35
            }
        }, BASEMAP_LINE_ANCHOR);
    });

    // --- Terrain derivatives: slope (per-region) ----------------------
    const DERIVATIVES_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/terrain/derivatives';

    const slopeTiers = [
        { id: 'slope-conus',  file: 'slope_conus_z11-12.pmtiles',  minzoom: 11, maxzoom: 22 },
        { id: 'slope-alaska', file: 'slope_alaska_z11-12.pmtiles', minzoom: 11, maxzoom: 22 },
        { id: 'slope-hawaii', file: 'slope_hawaii_z11-12.pmtiles', minzoom: 11, maxzoom: 22 }
    ];

    slopeTiers.forEach(tier => {
        map.addSource(tier.id, {
            type: 'raster-dem',
            url: `pmtiles://${DERIVATIVES_BASE}/${tier.file}`,
            encoding: 'custom',
            redFactor: 65536,
            greenFactor: 256,
            blueFactor: 1,
            baseShift: 0,
            tileSize: 512,
            minzoom: 11,
            maxzoom: 12
        });
        map.addLayer({
            id: `${tier.id}-layer`,
            type: 'color-relief',
            source: tier.id,
            minzoom: tier.minzoom,
            maxzoom: tier.maxzoom,
            layout: { visibility: 'none' },
            paint: {
                'color-relief-opacity': 0.6,
                'color-relief-color': [
                    'interpolate',
                    ['linear'],
                    ['elevation'],
                    0,  'rgba(0, 200, 0, 0)',
                    5,  'rgba(50, 200, 0, 0.3)',
                    15, 'rgba(200, 200, 0, 0.5)',
                    30, 'rgba(255, 120, 0, 0.7)',
                    60, 'rgba(200, 0, 0, 0.9)'
                ]
            }
        }, BASEMAP_LINE_ANCHOR);
    });

    // --- Terrain derivatives: aspect (per-region) ---------------------
    const aspectTiers = [
        { id: 'aspect-conus',  file: 'aspect_conus_z11-12.pmtiles',  minzoom: 11, maxzoom: 22 },
        { id: 'aspect-alaska', file: 'aspect_alaska_z11-12.pmtiles', minzoom: 11, maxzoom: 22 },
        { id: 'aspect-hawaii', file: 'aspect_hawaii_z11-12.pmtiles', minzoom: 11, maxzoom: 22 }
    ];

    aspectTiers.forEach(tier => {
        map.addSource(tier.id, {
            type: 'raster',
            url: `pmtiles://${DERIVATIVES_BASE}/${tier.file}`,
            tileSize: 512,
            minzoom: 11,
            maxzoom: 12
        });
        map.addLayer({
            id: `${tier.id}-layer`,
            type: 'raster',
            source: tier.id,
            minzoom: tier.minzoom,
            maxzoom: tier.maxzoom,
            layout: { visibility: 'none' },
            paint: {
                'raster-opacity': 1.0,
                'raster-resampling': 'nearest'
            }
        }, BASEMAP_LINE_ANCHOR);
    });

    // --- Tree canopy cover -----------------------------------------------
    const CANOPY_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/canopy';

    [
        { id: 'canopy-conus',   file: 'conus_canopy.pmtiles' },
        { id: 'canopy-seak',    file: 'seak_canopy.pmtiles'  },
        { id: 'canopy-hawaii',  file: 'hawaii_canopy.pmtiles' }
    ].forEach(region => {
        map.addSource(region.id, {
            type: 'raster',
            url: `pmtiles://${CANOPY_BASE}/${region.file}`,
            tileSize: 256,
            maxzoom: 12
        });
        map.addLayer({
            id: `${region.id}-layer`,
            type: 'raster',
            source: region.id,
            minzoom: 4,
            maxzoom: 22,
            paint: {
                'raster-opacity': 0.20,
                'raster-resampling': 'linear'
            },
            layout: { visibility: 'none' }
        }, BASEMAP_LINE_ANCHOR);
    });

    // --- Tree species composite (CONUS) --------------------------------
    // New dual-layer architecture: this is the display tile (full color,
    // alpha=255). Hover lookup reads the parallel _data.pmtiles file via
    // the pmtiles JS library, never added to the style.
    map.addSource('tree-species', {
        type: 'raster',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus.pmtiles',
        tileSize: 256,
        minzoom: 4,
        maxzoom: 14,
    });
    map.addLayer({
        id: 'tree-species-layer',
        type: 'raster',
        source: 'tree-species',
        minzoom: 4,
        maxzoom: 22,
        paint: {
            'raster-opacity': .35,
            'raster-resampling': 'nearest',
        },
        layout: { visibility: 'none' }
    }, BASEMAP_LINE_ANCHOR);

    // --- LANDFIRE EVT — Alaska + Hawaii --------------------------------
    // Will switch to dual-layer architecture once the AK/HI pipeline rerun
    // completes. Until then these use the alpha-index trick for hover.
    [
        { region: 'ak', file: 'landfire_evt_ak.pmtiles' },
        { region: 'hi', file: 'landfire_evt_hi.pmtiles' },
    ].forEach(r => {
        const id = `tree-species-${r.region}`;
        map.addSource(id, {
            type: 'raster',
            url: `pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/${r.file}`,
            tileSize: 256,
            minzoom: 4,
            maxzoom: 14,
        });
        map.addLayer({
            id: `${id}-layer`,
            type: 'raster',
            source: id,
            minzoom: 4,
            maxzoom: 22,
            paint: {
                'raster-opacity': 0.35,
                'raster-resampling': 'nearest',
            },
            layout: { visibility: 'none' }
        }, BASEMAP_LINE_ANCHOR);
    });

    // --- Contours (per-region, per-zoom tiers) ------------------------
    const CONTOUR_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/contours';
    const CONTOUR_REGION_INTERVALS = {
        hawaii: { 8: '750ft', 9: '500ft', 10: '250ft', 11: '150ft', 12: '100ft', 13: '50ft' },
        alaska: { 8: '1000ft', 9: '500ft', 10: '400ft', 11: '200ft', 12: '200ft', 13: '100ft' },
        conus:  { 8: '750ft', 9: '500ft', 10: '250ft', 11: '150ft', 12: '100ft', 13: '50ft' }
    };

    const CONTOUR_ZOOM_TIERS = [
        { zoom: 10, minzoom: 10, maxzoom: 11, wIntermediate: 0.6, wIndex: 1.1 },
        { zoom: 11, minzoom: 11, maxzoom: 12, wIntermediate: 0.7, wIndex: 1.1 },
        { zoom: 12, minzoom: 12, maxzoom: 13, wIntermediate: 0.7, wIndex: 1.2 },
        { zoom: 13, minzoom: 13, maxzoom: 22, wIntermediate: 0.8, wIndex: 1.2 }
    ];

    Object.keys(CONTOUR_REGION_INTERVALS).forEach(region => {
        CONTOUR_ZOOM_TIERS.forEach(tier => {
            const interval = CONTOUR_REGION_INTERVALS[region][tier.zoom];
            const srcId = `contours-${region}-z${tier.zoom}`;
            const file  = `${region}_contour_${interval}_z${tier.zoom}.pmtiles`;

            map.addSource(srcId, {
                type: 'vector',
                url: `pmtiles://${CONTOUR_BASE}/${file}`
            });

            map.addLayer({
                id: `contour-intermediate-${region}-z${tier.zoom}`,
                type: 'line',
                source: srcId,
                'source-layer': 'contours',
                filter: ['==', ['get', 'idx'], 0],
                minzoom: tier.minzoom,
                maxzoom: tier.maxzoom,
                paint: {
                    'line-color': CONTOUR_INTERMEDIATE_COLOR,
                    'line-width': tier.wIntermediate,
                    'line-opacity': 0.5
                }
            }, BASEMAP_LINE_ANCHOR);

            map.addLayer({
                id: `contour-index-${region}-z${tier.zoom}`,
                type: 'line',
                source: srcId,
                'source-layer': 'contours',
                filter: ['==', ['get', 'idx'], 1],
                minzoom: tier.minzoom,
                maxzoom: tier.maxzoom,
                paint: {
                    'line-color': CONTOUR_INDEX_COLOR,
                    'line-width': tier.wIndex,
                    'line-opacity': 0.7
                }
            }, BASEMAP_LINE_ANCHOR);
        });
    });

    // =============================================================================
    // TRAILS (OSM path family — dedicated PMTiles)
    // =============================================================================

    map.addSource('trails', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/trails/trails-na-20260524.pmtiles'
    });

    map.addLayer({
        id: 'trails-bridleway',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        minzoom: 11,
        filter: ['==', ['get', 'highway'], 'bridleway'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#7a4f2e',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'],
                11, 0.8, 12, 1.4, 15, 2.5, 18, 4.0
            ],
            'line-dasharray': [3, 2],
            'line-opacity': 0.8
        }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'trails-cycleway',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        minzoom: 11,
        filter: ['==', ['get', 'highway'], 'cycleway'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#2e6b8b',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'],
                11, 0.7, 12, 1.2, 15, 2.0, 18, 3.0
            ],
            'line-opacity': 0.7
        }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'trails-footway-real',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        minzoom: 13,
        filter: ['all',
            ['==', ['get', 'highway'], 'footway'],
            ['!', ['in', ['get', 'footway'], ['literal', [
                'sidewalk', 'crossing', 'access_aisle', 'traffic_island'
            ]]]],
            ['in', ['get', 'surface'], ['literal', [
                'dirt', 'ground', 'gravel', 'unpaved', 'grass',
                'mud', 'compacted', 'fine_gravel', 'bark', 'woodchips'
            ]]]
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#2d7a45',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'],
                13, 0.8, 15, 2.0, 18, 3.5
            ],
            'line-dasharray': [2, 1.5],
            'line-opacity': 0.85
        }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'trails-path-unknown',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        minzoom: 11,
        filter: ['all',
            ['==', ['get', 'highway'], 'path'],
            ['!', ['has', 'surface']]
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#1f6b3a',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'],
                11, 0.8, 12, 1.5, 15, 2.5, 18, 4.0
            ],
            'line-dasharray': [2, 2],
            'line-opacity': 0.75
        }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'trails-path-natural',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        minzoom: 11,
        filter: ['all',
            ['==', ['get', 'highway'], 'path'],
            ['in', ['get', 'surface'], ['literal', [
                'dirt', 'ground', 'gravel', 'unpaved', 'grass',
                'mud', 'compacted', 'fine_gravel', 'bark', 'woodchips',
                'dirt,gravel', 'woodchips;fine_gravel'
            ]]]
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#1f6b3a',
            'line-width': ['interpolate', ['exponential', 1.4], ['zoom'],
                11, 1.0, 12, 1.8, 15, 3.0, 18, 5.0
            ],
            'line-dasharray': [2, 1.5],
            'line-opacity': 1.0
        }
    }, BASEMAP_LINE_ANCHOR);

    map.addSource('nhd', {
        type: 'vector',
        url: 'pmtiles://https://protomaps-example.s3.us-west-2.amazonaws.com/us_hydro.pmtiles'
    });

    map.addSource('nhd-hover',    { type: 'geojson', data: empty });
    map.addSource('nhd-selected', { type: 'geojson', data: empty });

    const widthByStrahler = [
        'interpolate', ['linear'], ['zoom'],
        4,  ['*', 0.15, ['to-number', ['get', 'max_strahler']]],
        8,  ['*', 0.28, ['to-number', ['get', 'max_strahler']]],
        12, ['*', 0.52, ['to-number', ['get', 'max_strahler']]],
        16, ['*', 0.90, ['to-number', ['get', 'max_strahler']]],
        19, ['*', 1.40, ['to-number', ['get', 'max_strahler']]]
    ];

    const STREAM_LABEL_LAYOUT_BASE = {
        'text-field': ['get', 'gnis_name'],
        'text-font': LABEL_FONT,
        'symbol-placement': 'line',
        'text-letter-spacing': 0.03,
        'symbol-spacing': 100,
        'text-max-angle': 45,
        'text-padding': 0,
        'text-pitch-alignment': 'viewport',
        'text-max-width': 10,
        'symbol-avoid-edges': false
    };

    const STREAM_LABEL_PAINT = {
        'text-color': STREAM_COLOR,
        'text-halo-color': LABEL_HALO,
        'text-halo-width': 1.5,
        'text-halo-blur': 0.5
    };

    // ====================================================================
    // ALASKA HYDROGRAPHY
    // ====================================================================

    map.addSource('nhd_ak', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/nhd/nhd_ak_v5.pmtiles',
        maxzoom: 13
    });

    const widthByDrainage = [
        'interpolate', ['linear'], ['zoom'],
        4,  ['*', 0.25, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        8,  ['*', 0.45, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        12, ['*', 0.80, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        16, ['*', 1.40, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        19, ['*', 2.20, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]]
    ];

    map.addLayer({
        id: 'nhd-ak-streams',
        type: 'line',
        source: 'nhd_ak',
        'source-layer': 'streams',
        filter: ['all',
            ['has', 'gnis_name'],
            ['>=',
                ['to-number', ['get', 'total_lengthkm']],
                ['step', ['zoom'],
                    100,
                    5, 100, 6, 50, 7, 20, 9, 10, 11, 3, 13, 0
                ]
            ]
        ],
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': widthByDrainage,
            'line-opacity': 0.95
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-ak-waterbodies-fill',
        type: 'fill',
        source: 'nhd_ak',
        'source-layer': 'waterbodies',
        paint: { 'fill-color': WATER_FILL, 'fill-opacity': 0.95 }
    }, BASEMAP_LINE_ANCHOR);
    map.addLayer({
        id: 'nhd-ak-waterbodies-stroke',
        type: 'line',
        source: 'nhd_ak',
        'source-layer': 'waterbodies',
        paint: { 'line-color': STREAM_COLOR, 'line-width': 0.8, 'line-opacity': 0.9 }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-ak-streams-label-high',
        type: 'symbol',
        source: 'nhd_ak',
        'source-layer': 'streams_labels_high',
        minzoom: 5,
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 8, 13, 12, 15]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-ak-streams-label-mid',
        type: 'symbol',
        source: 'nhd_ak',
        'source-layer': 'streams_labels_mid',
        minzoom: 9,
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 12, 16, 14]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-ak-streams-label-low',
        type: 'symbol',
        source: 'nhd_ak',
        'source-layer': 'streams_labels_low',
        minzoom: 12,
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-ak-waterbodies-label',
        type: 'symbol',
        source: 'nhd_ak',
        'source-layer': 'waterbodies',
        minzoom: 6,
        filter: ['all',
            ['has', 'gnis_name'],
            ['>=',
                ['to-number', ['get', 'areasqkm']],
                ['step', ['zoom'],
                    200,
                    6, 15, 7, 5, 8, 1.5, 9, 0.5, 10, 0.02, 12, 0
                ]
            ]
        ],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': LABEL_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 13, 14, 15],
            'text-max-width': 8,
            'text-letter-spacing': 0.02,
            'text-padding': 0
        },
        paint: {
            'text-color': STREAM_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 1.8,
            'text-halo-blur': 0.5
        }
    }, BASEMAP_LINE_ANCHOR);

    // ====================================================================
    // CONUS+HI HYDROGRAPHY
    // ====================================================================

    map.addSource('nhd_conus', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/nhd/nhd_conus_v2.pmtiles',
        maxzoom: 13
    });

    const widthByArbolate = [
        'interpolate', ['linear'], ['zoom'],
        3,  ['*', 0.14, ['log10', ['max', 1, ['to-number', ['get', 'arbolatesu']]]]],
        6,  ['*', 0.24, ['log10', ['max', 1, ['to-number', ['get', 'arbolatesu']]]]],
        10, ['*', 0.44, ['log10', ['max', 1, ['to-number', ['get', 'arbolatesu']]]]],
        14, ['*', 0.80, ['log10', ['max', 1, ['to-number', ['get', 'arbolatesu']]]]],
        19, ['*', 1.44, ['log10', ['max', 1, ['to-number', ['get', 'arbolatesu']]]]]
    ];

    map.addLayer({
        id: 'nhd-conus-streams',
        type: 'line',
        source: 'nhd_conus',
        'source-layer': 'streams',
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': widthByArbolate,
            'line-opacity': 0.95
        },
        filter: ['>=',
            ['to-number', ['get', 'lengthkm']],
            ['step', ['zoom'],
                200,
                5, 100, 7, 50, 9, 15, 11, 5, 13, 0
            ]
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' }
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-conus-waterbodies-fill',
        type: 'fill',
        source: 'nhd_conus',
        'source-layer': 'waterbodies',
        paint: { 'fill-color': WATER_FILL, 'fill-opacity': 0.95 },
        filter: ['all',
            ['!', ['in', ['get', 'ftype'], ['literal', [361, 378, 466]]]],
            ['>=',
                ['to-number', ['get', 'areasqkm']],
                ['step', ['zoom'],
                    100,
                    5, 20, 7, 5, 9, 0.5, 11, 0.05, 13, 0
                ]
            ]
        ]
    }, BASEMAP_LINE_ANCHOR);
    map.addLayer({
        id: 'nhd-conus-waterbodies-stroke',
        type: 'line',
        source: 'nhd_conus',
        'source-layer': 'waterbodies',
        paint: { 'line-color': STREAM_COLOR, 'line-width': 0.8, 'line-opacity': 0.9 },
        filter: ['all',
            ['!', ['in', ['get', 'ftype'], ['literal', [361, 378, 466]]]],
            ['>=',
                ['to-number', ['get', 'areasqkm']],
                ['step', ['zoom'],
                    100,
                    5, 20, 7, 5, 9, 0.5, 11, 0.05, 13, 0
                ]
            ]
        ]
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-selected-label-line',
        type: 'symbol',
        source: 'nhd-selected',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': LABEL_FONT,
            'symbol-placement': 'line',
            'text-letter-spacing': 0.03,
            'symbol-spacing': 100,
            'text-max-angle': 45,
            'text-padding': 0,
            'text-max-width': 10,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 10, 14, 14, 16],
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: {
            'text-color': SELECTED_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 2,
            'text-halo-blur': 0.3
        }
    });

    map.addLayer({
        id: 'nhd-selected-label-point',
        type: 'symbol',
        source: 'nhd-selected',
        filter: ['==', ['geometry-type'], 'Polygon'],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': LABEL_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 13, 10, 15, 14, 17],
            'text-max-width': 8,
            'text-letter-spacing': 0.02,
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: {
            'text-color': SELECTED_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 2,
            'text-halo-blur': 0.3
        }
    });

    map.addLayer({
        id: 'nhd-hover-halo-outer',
        type: 'line',
        source: 'nhd-hover',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': HOVER_COLOR,
            'line-width': ['interpolate', ['linear'], ['zoom'],
                4, 14, 10, 22, 14, 34, 17, 46
            ],
            'line-opacity': 0.25,
            'line-blur': 8
        }
    }, 'nhd-ak-streams');

    map.addLayer({
        id: 'nhd-hover-halo',
        type: 'line',
        source: 'nhd-hover',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': HOVER_COLOR,
            'line-width': ['interpolate', ['linear'], ['zoom'],
                4, 6, 10, 12, 14, 20, 17, 30
            ],
            'line-opacity': 0.55,
            'line-blur': 3
        }
    }, 'nhd-ak-streams');

    map.addLayer({
        id: 'nhd-hover-polygon-fill',
        type: 'fill',
        source: 'nhd-hover',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': HOVER_COLOR, 'fill-opacity': 0.3 }
    });
    map.addLayer({
        id: 'nhd-hover-polygon-stroke',
        type: 'line',
        source: 'nhd-hover',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': HOVER_COLOR, 'line-width': 3, 'line-opacity': 0.9 }
    });

    map.addLayer({
        id: 'nhd-selected',
        type: 'line',
        source: 'nhd-selected',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
            'line-color': SELECTED_COLOR,
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4,  ['max', 2, ['*', 0.30, ['to-number', ['get', 'max_strahler']]]],
                10, ['max', 3, ['*', 0.60, ['to-number', ['get', 'max_strahler']]]],
                14, ['max', 4, ['*', 1.10, ['to-number', ['get', 'max_strahler']]]],
                17, ['max', 5, ['*', 1.80, ['to-number', ['get', 'max_strahler']]]]
            ],
            'line-opacity': 1.0
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
    });

    map.addLayer({
        id: 'nhd-selected-polygon-fill',
        type: 'fill',
        source: 'nhd-selected',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': SELECTED_COLOR, 'fill-opacity': 0.3 }
    });
    map.addLayer({
        id: 'nhd-selected-polygon-stroke',
        type: 'line',
        source: 'nhd-selected',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': SELECTED_COLOR, 'line-width': 3, 'line-opacity': 1.0 }
    });

    map.addLayer({
        id: 'nhd-streams-label-large',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'streams_labels',
        minzoom: 6,
        filter: ['>=', ['to-number', ['get', 'max_strahler']], 6],
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 13, 14, 15]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-streams-label-medium',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'streams_labels',
        minzoom: 9,
        filter: [
            'all',
            ['>=', ['to-number', ['get', 'max_strahler']], 4],
            ['<=', ['to-number', ['get', 'max_strahler']], 5]
        ],
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 12, 16, 14]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-streams-label-small',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'streams_labels',
        minzoom: 12,
        filter: ['<=', ['to-number', ['get', 'max_strahler']], 3],
        layout: {
            ...STREAM_LABEL_LAYOUT_BASE,
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13]
        },
        paint: STREAM_LABEL_PAINT
    }, BASEMAP_LINE_ANCHOR);

    map.addLayer({
        id: 'nhd-waterbodies-label',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'waterbodies',
        minzoom: 6,
        filter: ['has', 'gnis_name'],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': LABEL_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 13, 14, 15],
            'text-max-width': 8,
            'text-letter-spacing': 0.02,
            'text-padding': 0
        },
        paint: {
            'text-color': STREAM_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 1.8,
            'text-halo-blur': 0.5
        }
    }, BASEMAP_LINE_ANCHOR);

    // H3 hexes
    map.addSource('h3-hexes', { type: 'geojson', data: empty });
    map.addLayer({
        id: 'h3-hexes-fill',
        type: 'fill',
        source: 'h3-hexes',
        paint: {
            'fill-color': [
                'interpolate', ['linear'], ['get', 'count'],
                1, '#fee5d9',
                2, '#fcae91',
                4, '#fb6a4a',
                8, '#cb181d'
            ],
            'fill-opacity': 0.55
        },
        layout: { visibility: 'none' }
    });
    map.addLayer({
        id: 'h3-hexes-line',
        type: 'line',
        source: 'h3-hexes',
        paint: { 'line-color': '#2c5530', 'line-width': 1, 'line-opacity': 0.7 },
        layout: { visibility: 'none' }
    });

    // Observations
    map.addSource('observations', { type: 'geojson', data: empty });
    map.addLayer({
        id: 'observations-layer',
        type: 'circle',
        source: 'observations',
        paint: {
            'circle-radius': 7,
            'circle-color': '#2c5530',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        }
    });

    // User's H3 cell from geolocation
    map.addSource('user-h3', { type: 'geojson', data: empty });
    map.addLayer({
        id: 'user-h3-fill',
        type: 'fill',
        source: 'user-h3',
        paint: { 'fill-color': '#2c5530', 'fill-opacity': 0.2 }
    });
    map.addLayer({
        id: 'user-h3-line',
        type: 'line',
        source: 'user-h3',
        paint: { 'line-color': '#2c5530', 'line-width': 2 }
    });
}

// --- Hydrography interactions: hover + click select + popup --------------

const HYDRO_INTERACTIVE_LAYERS = [
    'nhd-waterbodies-fill',
    'nhd-streams',
    'nhd-conus-streams',
    'nhd-conus-waterbodies-fill',
    'nhd-ak-streams',
    'nhd-ak-waterbodies-fill',
];

const HYDRO_CLICK_BUFFER_PX = 5;

function queryNearbyHydroFeature(point) {
    const map = state.map;
    const b = HYDRO_CLICK_BUFFER_PX;
    const bbox = [[point.x - b, point.y - b], [point.x + b, point.y + b]];
    const layers = HYDRO_INTERACTIVE_LAYERS.filter(id => map.getLayer(id));
    if (!layers.length) return null;
    const feats = map.queryRenderedFeatures(bbox, { layers });
    if (!feats.length) return null;
    return feats[0];
}

function toPlainFeature(f) {
    return {
        type: 'Feature',
        geometry: JSON.parse(JSON.stringify(f.geometry)),
        properties: f.properties ? { ...f.properties } : {}
    };
}

function setHoveredHydro(featureOrArray) {
    const src = state.map.getSource('nhd-hover');
    if (!src) return;
    if (!featureOrArray) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    const arr = Array.isArray(featureOrArray) ? featureOrArray : [featureOrArray];
    const features = arr.map(toPlainFeature);
    src.setData({ type: 'FeatureCollection', features });
}

function setSelectedHydro(featureOrArray) {
    const src = state.map.getSource('nhd-selected');
    if (!src) return;
    if (!featureOrArray) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
    }
    const arr = Array.isArray(featureOrArray) ? featureOrArray : [featureOrArray];
    const features = arr.map(toPlainFeature);
    src.setData({ type: 'FeatureCollection', features });
}

function clearSelectedHydro() { setSelectedHydro(null); }

function findAllFragments(clickedFeature) {
    const map = state.map;
    const gnisId = clickedFeature.properties?.gnis_id;
    if (!gnisId) return [clickedFeature];

    const layerId = clickedFeature.layer?.id;
    let sourceName, sourceLayer;

    if (layerId === 'nhd-streams')                   { sourceName = 'nhd';       sourceLayer = 'streams'; }
    else if (layerId === 'nhd-waterbodies-fill')      { sourceName = 'nhd';       sourceLayer = 'waterbodies'; }
    else if (layerId === 'nhd-areas-fill')            { sourceName = 'nhd';       sourceLayer = 'areas'; }
    else if (layerId === 'nhd-conus-streams')         { sourceName = 'nhd_conus'; sourceLayer = 'streams'; }
    else if (layerId === 'nhd-conus-waterbodies-fill'){ sourceName = 'nhd_conus'; sourceLayer = 'waterbodies'; }
    else if (layerId === 'nhd-ak-streams')            { sourceName = 'nhd_ak';    sourceLayer = 'streams'; }
    else if (layerId === 'nhd-ak-waterbodies-fill')   { sourceName = 'nhd_ak';    sourceLayer = 'waterbodies'; }
    else return [clickedFeature];

    const matches = map.querySourceFeatures(sourceName, {
        sourceLayer,
        filter: ['==', ['get', 'gnis_id'], gnisId]
    });

    if (!matches.length) return [clickedFeature];

    const isPolygonLayer = (sourceLayer === 'waterbodies' || sourceLayer === 'areas');
    if (isPolygonLayer && matches.length > 1 && typeof turf !== 'undefined') {
        try {
            const fc = turf.featureCollection(matches);
            const unioned = turf.union(fc);
            if (unioned) {
                unioned.properties = { ...matches[0].properties };
                return [unioned];
            }
        } catch (err) {
            console.warn('Polygon union failed, falling back to fragments:', err);
        }
    }

    return matches;
}

function fmtNumber(v, digits) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n.toFixed(digits);
}

function featureKind(feature) {
    const id = feature.layer?.id;
    if (id === 'nhd-streams' || id === 'nhd-conus-streams' || id === 'nhd-ak-streams') return 'stream';
    if (id === 'nhd-waterbodies-fill' || id === 'nhd-conus-waterbodies-fill' || id === 'nhd-ak-waterbodies-fill') return 'waterbody';
    if (id === 'nhd-areas-fill') return 'area';
    const gt = feature.geometry?.type;
    if (gt === 'LineString' || gt === 'MultiLineString') return 'stream';
    return 'waterbody';
}

function streamPopupHtml(feature) {
    const p = feature.properties || {};
    const name = p.gnis_name || null;
    const rows = [];

    if (p.max_strahler != null)   rows.push(['Stream order', p.max_strahler]);

    const rawKm = p.lengthkm ?? p.total_lengthkm ?? p.total_length_km;
    const lenKm = fmtNumber(rawKm, 1);
    if (lenKm !== null) {
        rows.push(['Length', `${lenKm} km (${(Number(lenKm) * 0.621371).toFixed(1)} mi)`]);
    }

    const rawDrain = p.max_totdasqkm ?? p.max_drainage_area_sqkm;
    const drain = fmtNumber(rawDrain, 0);
    if (drain !== null) rows.push(['Drainage area', `${drain} km²`]);

    if (drain === null && p.arbolatesu != null) {
        rows.push(['Arbolate sum', `${fmtNumber(p.arbolatesu, 0)} km`]);
    }

    const flow  = fmtNumber(p.avg_flow_cfs, 1);
    if (flow  !== null) rows.push(['Avg flow', `${flow} cfs`]);
    const slope = fmtNumber(p.avg_slope, 4);
    if (slope !== null) rows.push(['Avg gradient', `${(Number(slope) * 100).toFixed(2)}%`]);
    if (p.segment_count != null) rows.push(['NHD segments', p.segment_count]);
    if (p.gnis_id)               rows.push(['GNIS ID', p.gnis_id]);

    const title = name
        ? `<div class="fw-bold mb-2">${escapeHtml(String(name))}</div>`
        : `<div class="fw-bold mb-2 text-muted">Unnamed waterway</div>`;
    return wrapPopup(title, rows);
}

const WATERBODY_FTYPE_LABELS = {
    390: 'Lake/Pond', 436: 'Reservoir', 361: 'Playa',
    378: 'Ice mass', 466: 'Swamp/Marsh'
};
const AREA_FTYPE_LABELS = {
    460: 'Stream/River', 537: 'Sea/Ocean', 312: 'Bay/Inlet',
    445: 'Rapids', 487: 'Wash'
};

function waterbodyPopupHtml(feature, isArea) {
    const p = feature.properties || {};
    const name = p.gnis_name || null;
    const ftypeLabels = isArea ? AREA_FTYPE_LABELS : WATERBODY_FTYPE_LABELS;
    const typeLabel = ftypeLabels[p.ftype] || (p.ftype != null ? `FTYPE ${p.ftype}` : null);

    const rows = [];
    if (typeLabel) rows.push(['Type', typeLabel]);

    const areaKm = fmtNumber(p.areasqkm, 3);
    if (areaKm !== null) {
        const km = Number(areaKm);
        const acres = (km * 247.105).toFixed(0);
        rows.push(['Area', `${areaKm} km² (${acres} acres)`]);
    }
    const elev = fmtNumber(p.elevation, 0);
    if (elev !== null) {
        const ft = (Number(elev) * 3.28084).toFixed(0);
        rows.push(['Elevation', `${elev} m (${ft} ft)`]);
    }
    if (p.purpcode) rows.push(['Purpose', p.purpcode]);
    if (p.reachcode) rows.push(['Reach code', p.reachcode]);
    if (p.gnis_id) rows.push(['GNIS ID', p.gnis_id]);

    const title = name
        ? `<div class="fw-bold mb-2">${escapeHtml(String(name))}</div>`
        : `<div class="fw-bold mb-2 text-muted">Unnamed ${isArea ? 'water' : 'lake'}</div>`;
    return wrapPopup(title, rows);
}

function wrapPopup(title, rows) {
    const body = rows.map(([k, v]) =>
        `<div class="small d-flex justify-content-between gap-3">` +
        `<span class="text-muted">${escapeHtml(String(k))}</span>` +
        `<span><code>${escapeHtml(String(v))}</code></span>` +
        `</div>`
    ).join('');
    return `<div class="hydro-popup" style="min-width: 220px;">${title}${body}</div>`;
}

function hydroPopupHtml(feature) {
    const kind = featureKind(feature);
    if (kind === 'stream') return streamPopupHtml(feature);
    if (kind === 'area')   return waterbodyPopupHtml(feature, true);
    return waterbodyPopupHtml(feature, false);
}

async function openHydroPopup(feature, lngLat) {
    if (state.openPopup) {
        state.openPopup.remove();
        state.openPopup = null;
    }

    const p = feature.properties || {};
    const gnisId = p.gnis_id || null;

    const featureHtml = hydroPopupHtml(feature);
    const commentsHtml = gnisId
        ? `<div class="hydro-comments mt-2 pt-2" style="border-top: 1px solid #dee2e6;">
               <div class="small fw-semibold mb-1" style="color:#2e6f96;">Comments</div>
               <div class="hydro-comments-list small text-muted">Loading…</div>
               <div class="hydro-comment-form mt-2">
                   <textarea class="form-control form-control-sm hydro-comment-input"
                       rows="2" placeholder="Add a comment…" maxlength="1000"
                       style="resize:none;font-size:0.78rem;"></textarea>
                   <div class="d-flex align-items-center justify-content-between mt-1 gap-2">
                       <div class="form-check form-check-inline m-0">
                           <input class="form-check-input hydro-comment-public" type="checkbox" checked>
                           <label class="form-check-label small text-muted" style="font-size:0.72rem;">
                               Public
                           </label>
                       </div>
                       <div>
                           <span class="hydro-comment-error text-danger small me-2 d-none"
                               style="font-size:0.72rem;"></span>
                           <button class="btn btn-sm btn-outline-secondary hydro-comment-submit"
                               style="font-size:0.75rem;">Post</button>
                       </div>
                   </div>
               </div>
           </div>`
        : '';

    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '320px',
    })
        .setLngLat(lngLat)
        .setHTML(featureHtml + commentsHtml)
        .addTo(state.map);

    popup.on('close', () => {
        clearSelectedHydro();
        if (state.openPopup === popup) state.openPopup = null;
    });

    state.openPopup = popup;

    if (!gnisId) return;

    const el = popup.getElement();
    const listEl     = el.querySelector('.hydro-comments-list');
    const input      = el.querySelector('.hydro-comment-input');
    const publicChk  = el.querySelector('.hydro-comment-public');
    const submitBtn  = el.querySelector('.hydro-comment-submit');
    const errEl      = el.querySelector('.hydro-comment-error');
    const gnisName   = p.gnis_name || '';

    const { apiFetch } = await import('./api.js');

    async function loadComments() {
        listEl.innerHTML = '<span class="text-muted">Loading…</span>';
        try {
            const resp = await fetch(`/api/v1/waterbody-comments/?gnis_id=${encodeURIComponent(gnisId)}`);
            const data = await resp.json();
            const comments = Array.isArray(data) ? data : (data.results ?? []);
            if (!comments.length) {
                listEl.innerHTML = '<span class="text-muted">No comments yet.</span>';
                return;
            }
            const currentUsername = window.state?.currentUser?.username
                                 || window.state?.currentUser?.email
                                 || null;
            listEl.innerHTML = comments.map(c => renderComment(c, currentUsername)).join('');
            wireCommentRowActions();
        } catch {
            listEl.innerHTML = '<span class="text-danger">Could not load comments.</span>';
        }
    }

    function renderComment(c, currentUsername) {
        const when = new Date(c.created_at).toLocaleDateString();
        const privateBadge = c.is_public === false
            ? ' <span class="badge bg-secondary" style="font-size:0.6rem;">private</span>'
            : '';
        const mine = currentUsername && c.username === currentUsername;
        const editLink = mine
            ? `<button class="btn btn-link btn-sm p-0 ms-1 hydro-comment-edit"
                       data-comment-id="${escapeHtml(c.id)}"
                       style="font-size:0.7rem;">edit</button>`
            : '';
        return `<div class="mb-2 hydro-comment-row" data-comment-id="${escapeHtml(c.id)}">
            <div class="hydro-comment-display">
                <span class="fw-semibold">${escapeHtml(c.username)}</span>
                <span class="text-muted ms-1">${when}</span>${privateBadge}${editLink}
                <div class="hydro-comment-body">${escapeHtml(c.body)}</div>
            </div>
            <div class="hydro-comment-edit-form d-none">
                <textarea class="form-control form-control-sm hydro-comment-edit-input"
                    rows="2" maxlength="1000"
                    style="resize:none;font-size:0.78rem;">${escapeHtml(c.body)}</textarea>
                <div class="d-flex align-items-center justify-content-between mt-1 gap-2">
                    <div class="form-check form-check-inline m-0">
                        <input class="form-check-input hydro-comment-edit-public" type="checkbox" ${c.is_public ? 'checked' : ''}>
                        <label class="form-check-label small text-muted" style="font-size:0.72rem;">Public</label>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-link text-muted hydro-comment-edit-cancel" style="font-size:0.75rem;">Cancel</button>
                        <button class="btn btn-sm btn-outline-secondary hydro-comment-edit-save" style="font-size:0.75rem;">Update</button>
                    </div>
                </div>
                <div class="hydro-comment-edit-error text-danger small mt-1 d-none" style="font-size:0.72rem;"></div>
            </div>
        </div>`;
    }

    function wireCommentRowActions() {
        listEl.querySelectorAll('.hydro-comment-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.hydro-comment-row');
                row.querySelector('.hydro-comment-display').classList.add('d-none');
                row.querySelector('.hydro-comment-edit-form').classList.remove('d-none');
            });
        });
        listEl.querySelectorAll('.hydro-comment-edit-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.hydro-comment-row');
                row.querySelector('.hydro-comment-edit-form').classList.add('d-none');
                row.querySelector('.hydro-comment-display').classList.remove('d-none');
            });
        });
        listEl.querySelectorAll('.hydro-comment-edit-save').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('.hydro-comment-row');
                const id = row.dataset.commentId;
                const newBody = row.querySelector('.hydro-comment-edit-input').value.trim();
                const newPublic = row.querySelector('.hydro-comment-edit-public').checked;
                const editErrEl = row.querySelector('.hydro-comment-edit-error');
                editErrEl.classList.add('d-none');
                if (!newBody) return;
                btn.disabled = true;
                try {
                    const resp = await apiFetch(`/api/v1/waterbody-comments/${id}/`, {
                        method: 'PATCH',
                        body: JSON.stringify({ body: newBody, is_public: newPublic }),
                    });
                    if (resp.ok) {
                        await loadComments();
                    } else {
                        editErrEl.textContent = 'Could not update.';
                        editErrEl.classList.remove('d-none');
                    }
                } catch {
                    editErrEl.textContent = 'Network error.';
                    editErrEl.classList.remove('d-none');
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    submitBtn.addEventListener('click', async () => {
        const body = input.value.trim();
        if (!body) return;
        errEl.classList.add('d-none');
        submitBtn.disabled = true;
        try {
            const resp = await apiFetch('/api/v1/waterbody-comments/', {
                method: 'POST',
                body: JSON.stringify({
                    gnis_id: gnisId,
                    gnis_name: gnisName,
                    body,
                    is_public: publicChk.checked,
                    click_lng: lngLat.lng,
                    click_lat: lngLat.lat,
                    bbox: computeFeatureBbox(findAllFragments(feature)),
                }),
            });
            if (resp.ok) {
                input.value = '';
                await loadComments();
            } else if (resp.status === 401 || resp.status === 403) {
                errEl.textContent = 'Sign in to post a comment.';
                errEl.classList.remove('d-none');
            } else {
                errEl.textContent = 'Could not post. Try again.';
                errEl.classList.remove('d-none');
            }
        } catch {
            errEl.textContent = 'Network error.';
            errEl.classList.remove('d-none');
        } finally {
            submitBtn.disabled = false;
        }
    });

    await loadComments();
}

function wireHydroInteractions() {
    const map = state.map;
    let lastHoveredKey = null;

    map.on('mousemove', (e) => {
        if (state.queryMode) return;
        if (state.crosshairMode) return;
        const feat = queryNearbyHydroFeature(e.point);
        if (!feat) {
            if (lastHoveredKey !== null) {
                setHoveredHydro(null);
                lastHoveredKey = null;
                map.getCanvas().style.cursor = '';
            }
            return;
        }
        const key = feat.properties.gnis_id ||
                    (feat.layer.id + ':' + JSON.stringify(feat.geometry?.coordinates?.[0] || []));
        if (key !== lastHoveredKey) {
            setHoveredHydro(findAllFragments(feat));
            lastHoveredKey = key;
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('click', (e) => {
        if (state.queryMode) return;
        if (state.crosshairMode) return;
        if (map.getLayer('observations-layer')) {
            const obsHit = map.queryRenderedFeatures(e.point, { layers: ['observations-layer'] });
            if (obsHit.length) return;
        }
        const feat = queryNearbyHydroFeature(e.point);
        if (!feat) {
            clearSelectedHydro();
            return;
        }
        setSelectedHydro(findAllFragments(feat));
        openHydroPopup(feat, e.lngLat);
    });
}

// =============================================================================
// Tree species hover lookup (CONUS / AK / HI)
// =============================================================================
// Each region has its own PMTiles + legend JSON. The hover handler picks the
// right region based on the lng/lat (CONUS bbox, AK bbox, HI bbox) and reads
// the underlying tile pixel for exact species lookup.
//
// CONUS uses dual-layer architecture: a display tile (RGBA at alpha=255) and
// a parallel data tile (FORTYPCD encoded as R high byte + G low byte) for
// bulletproof species lookup.
//
// AK and HI still use the old alpha-channel-as-species-index trick until
// their pipelines are rerun with the new architecture.

const TREE_SPECIES_REGIONS = [
    {
        name: 'conus',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus_data.pmtiles',
        legendUrl:      'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus_legend.json',
        bbox: [-125.5, 24.0, -66.0, 50.0],
        lookupType: 'data-tile',
        maxZoom: 14,
    },
    {
        name: 'ak',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak_data.pmtiles',
        legendUrl:      'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak_legend.json',
        bbox: [-180.0, 51.0, -129.0, 72.0],
        lookupType: 'data-tile',
        maxZoom: 14,
    },
    {
        name: 'hi',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_hi.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_hi_data.pmtiles',
        legendUrl:      'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_hi_legend.json',
        bbox: [-161.0, 18.5, -154.5, 23.0],
        lookupType: 'data-tile',
        maxZoom: 14,
    },
];

const _treeRegionState = new Map();
let _treeTooltipEl = null;

function getRegionState(region) {
    if (_treeRegionState.has(region.name)) return _treeRegionState.get(region.name);
    const s = {
        pmtiles: new pmtiles.PMTiles(region.pmtilesUrl),
        dataPmtiles: region.dataPmtilesUrl ? new pmtiles.PMTiles(region.dataPmtilesUrl) : null,
        lookupByFortypcd: null,   // CONUS: { code: { name, hex, rgb } }
        lookupByAlpha: null,      // AK/HI alpha-index path (legacy)
        legendLoaded: false,
        displayTileCache: new Map(),
        dataTileCache: new Map(),
    };
    _treeRegionState.set(region.name, s);
    return s;
}

async function loadRegionLegend(region) {
    const s = getRegionState(region);
    if (s.legendLoaded) return s;
    try {
        const resp = await fetch(region.legendUrl);
        const raw = await resp.json();
        if (region.lookupType === 'data-tile') {
            // Dual-layer format. CONUS: { by_fortypcd: {...} }. AK/HI: { by_evt_code: {...} }
            s.lookupByFortypcd = new Map();
            const src = raw.by_fortypcd || raw.by_evt_code || raw;
            for (const [code, info] of Object.entries(src)) {
                s.lookupByFortypcd.set(code, info);
            }
        } else {
            // AK/HI alpha-index: { by_evt_code: {... alpha ...}, by_alpha: {...} }
            // OR legacy flat { "code": { name, rgb, hex } } — both supported
            s.lookupByAlpha = new Map();
            if (raw.by_alpha) {
                for (const [alphaStr, info] of Object.entries(raw.by_alpha)) {
                    s.lookupByAlpha.set(parseInt(alphaStr, 10), info);
                }
            } else if (raw.by_evt_code) {
                for (const [code, info] of Object.entries(raw.by_evt_code)) {
                    if (info.alpha != null) {
                        s.lookupByAlpha.set(info.alpha, { ...info, evt_code: parseInt(code, 10) });
                    }
                }
            }
        }
        s.legendLoaded = true;
    } catch (err) {
        console.warn(`Legend load failed for ${region.name}:`, err);
    }
    return s;
}

function regionForLngLat(lng, lat) {
    for (const r of TREE_SPECIES_REGIONS) {
        const [w, s, e, n] = r.bbox;
        if (lng >= w && lng <= e && lat >= s && lat <= n) return r;
    }
    return null;
}

function ensureTreeTooltip() {
    if (_treeTooltipEl) return _treeTooltipEl;
    const el = document.createElement('div');
    el.className = 'tree-species-tooltip';
    el.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: rgba(20, 20, 20, 0.85);
        color: #fff;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 0.78rem;
        line-height: 1.35;
        z-index: 9999;
        display: none;
        white-space: normal;
        word-wrap: break-word;
        max-width: 260px;
        width: max-content;
    `;
    document.body.appendChild(el);
    _treeTooltipEl = el;
    return el;
}

function showTreeTooltip(x, y, html) {
    const el = ensureTreeTooltip();
    el.innerHTML = html;
    el.style.left = (x + 12) + 'px';
    el.style.top = (y + 12) + 'px';
    el.style.display = 'block';
}

function hideTreeTooltip() {
    if (_treeTooltipEl) _treeTooltipEl.style.display = 'none';
}

function lngLatToTilePixel(lng, lat, zoom) {
    const n = Math.pow(2, zoom);
    const xFloat = (lng + 180) / 360 * n;
    const latRad = lat * Math.PI / 180;
    const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    const x = Math.floor(xFloat);
    const y = Math.floor(yFloat);
    const px = Math.floor((xFloat - x) * 256);
    const py = Math.floor((yFloat - y) * 256);
    return { x, y, px, py };
}

async function fetchAndCacheTile(pmtilesInst, cache, z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);

    let tileBytes;
    try {
        const result = await pmtilesInst.getZxy(z, x, y);
        if (!result) return null;
        tileBytes = result.data;
    } catch (err) {
        return null;
    }

    const blob = new Blob([tileBytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, 256, 256);

        if (cache.size > 200) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        cache.set(key, data);
        return data;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function lookupTreeSpeciesAt(lngLat) {
    const region = regionForLngLat(lngLat.lng, lngLat.lat);
    if (!region) return null;

    const s = await loadRegionLegend(region);
    const z = Math.min(region.maxZoom, Math.floor(state.map.getZoom()));
    const { x, y, px, py } = lngLatToTilePixel(lngLat.lng, lngLat.lat, z);

    const displayImg = await fetchAndCacheTile(s.pmtiles, s.displayTileCache, z, x, y);
    if (!displayImg) return null;

    const idx = (py * 256 + px) * 4;
    const a = displayImg.data[idx + 3];
    if (a === 0) return null;

    if (region.lookupType === 'data-tile') {
        if (!s.dataPmtiles || !s.lookupByFortypcd) return null;
        const dataImg = await fetchAndCacheTile(s.dataPmtiles, s.dataTileCache, z, x, y);
        if (!dataImg) return null;
        const fortypcd = (dataImg.data[idx] << 8) | dataImg.data[idx + 1];
        if (fortypcd === 0) return null;
        return s.lookupByFortypcd.get(String(fortypcd)) || null;
    }
    // alpha-index
    return s.lookupByAlpha ? (s.lookupByAlpha.get(a) || null) : null;
}

function wireTreeSpeciesHover() {
    const map = state.map;
    let lastTimer = null;

    map.on('mousemove', (e) => {
        const anyVisible = ['tree-species-layer', 'tree-species-ak-layer', 'tree-species-hi-layer']
            .some(id => map.getLayer(id)
                && map.getLayoutProperty(id, 'visibility') !== 'none');
        if (!anyVisible) {
            hideTreeTooltip();
            return;
        }

        clearTimeout(lastTimer);
        lastTimer = setTimeout(async () => {
            const hit = await lookupTreeSpeciesAt(e.lngLat);
            if (!hit) {
                hideTreeTooltip();
                return;
            }
            const html =
            `<div style="display:flex;align-items:flex-start;gap:6px;">
                <span style="display:inline-block;width:10px;height:10px;flex-shrink:0;margin-top:3px;
                    background:${hit.hex};border:1px solid rgba(255,255,255,0.4);"></span>
                <span>${escapeHtml(hit.name)}</span>
            </div>`;
            showTreeTooltip(e.originalEvent.clientX, e.originalEvent.clientY, html);
        }, 40);
    });

    map.on('mouseout', hideTreeTooltip);
}

// =============================================================================
// Crosshair pick mode
// =============================================================================

let crosshairResolver = null;

export function enterCrosshairMode() {
    return new Promise((resolve) => {
        if (state.crosshairMode) {
            resolve(null);
            return;
        }
        state.crosshairMode = true;
        crosshairResolver = resolve;
        document.body.classList.add('crosshair-mode');
        document.getElementById('crosshairOverlay')?.classList.remove('d-none');
        document.getElementById('crosshairBar')?.classList.remove('d-none');
    });
}

function computeFeatureBbox(fragments) {
    const lngs = [], lats = [];
    for (const f of fragments) {
        collectCoords(f.geometry, lngs, lats);
    }
    if (!lngs.length) return null;
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function collectCoords(geometry, lngs, lats) {
    const push = c => { lngs.push(c[0]); lats.push(c[1]); };
    switch (geometry.type) {
        case 'Point':
            push(geometry.coordinates); break;
        case 'LineString':
        case 'MultiPoint':
            geometry.coordinates.forEach(push); break;
        case 'Polygon':
        case 'MultiLineString':
            geometry.coordinates.forEach(r => r.forEach(push)); break;
        case 'MultiPolygon':
            geometry.coordinates.forEach(p => p.forEach(r => r.forEach(push))); break;
    }
}

function exitCrosshairMode(coords) {
    if (!state.crosshairMode) return;
    state.crosshairMode = false;
    document.body.classList.remove('crosshair-mode');
    document.getElementById('crosshairOverlay')?.classList.add('d-none');
    document.getElementById('crosshairBar')?.classList.add('d-none');
    const r = crosshairResolver;
    crosshairResolver = null;
    if (r) r(coords);
}

export function initCrosshair() {
    const confirmBtn = document.getElementById('crosshairConfirm');
    const cancelBtn = document.getElementById('crosshairCancel');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const c = state.map.getCenter();
            exitCrosshairMode({ longitude: c.lng, latitude: c.lat });
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => exitCrosshairMode(null));
    }
}

// --- Layer panel rendering + toggle sync ----------------------------------

export function initLayerPanels() {
    const template = document.getElementById('layerPanelTemplate');
    renderPanelInto(template, document.querySelector('.side-panel-body'), 'desk');
    renderPanelInto(template, document.getElementById('layersSheetBody'), 'mob');

    document.querySelectorAll('.layer-toggle').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const group = e.target.dataset.layerGroup;
            const visible = e.target.checked;
            setLayerGroupVisibility(group, visible);
            document.querySelectorAll(`.layer-toggle[data-layer-group="${group}"]`)
                .forEach(other => { if (other !== e.target) other.checked = visible; });
        });
    });
}

function renderPanelInto(template, container, contextSuffix) {
    if (!container) return;
    const clone = template.content.cloneNode(true);
    clone.querySelectorAll('[id$="-CTX"]').forEach(el => {
        el.id = el.id.replace(/-CTX$/, `-${contextSuffix}`);
    });
    clone.querySelectorAll('label[for$="-CTX"]').forEach(label => {
        label.htmlFor = label.htmlFor.replace(/-CTX$/, `-${contextSuffix}`);
    });
    container.appendChild(clone);
}

export function setLayerGroupVisibility(group, visible) {
    (LAYER_IDS[group] || []).forEach(id => {
        if (state.map.getLayer(id)) {
            state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

export function isLayerGroupVisible(group) {
    const ids = LAYER_IDS[group] || [];
    if (!ids.length) return false;
    const layer = ids[0];
    if (!state.map.getLayer(layer)) return false;
    return state.map.getLayoutProperty(layer, 'visibility') !== 'none';
}

// --- FAB button wiring ----------------------------------------------------

export function wireFabs(onAddObservation) {
    document.getElementById('fabGeolocate').addEventListener('click', () => {
        state.geolocate.trigger();
    });
    document.getElementById('fabPrimary').addEventListener('click', onAddObservation);

    const compassBtn = document.getElementById('fabCompass');
    const compassIcon = compassBtn.querySelector('i');
    compassBtn.addEventListener('click', () => {
        state.map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    });
    state.map.on('rotate', () => {
        compassIcon.style.transform = `rotate(${-state.map.getBearing()}deg)`;
    });
}

// --- Query mode -----------------------------------------------------------

export function initQueryMode() {
    const btn = document.getElementById('fabQuery');
    btn.addEventListener('click', () => {
        state.queryMode = !state.queryMode;
        btn.setAttribute('aria-pressed', state.queryMode ? 'true' : 'false');
        document.body.classList.toggle('query-mode', state.queryMode);
        if (!state.queryMode) {
            document.getElementById('queryResult').classList.add('d-none');
        }
    });

    state.map.on('click', (e) => {
        if (!state.queryMode) return;

        const features = state.map.queryRenderedFeatures(e.point);

        const resultEl = document.getElementById('queryResult');
        const bodyEl = document.getElementById('queryResultBody');

        if (features.length === 0) {
            bodyEl.innerHTML = '<em class="text-muted">No features at this location.</em>';
        } else {
            const groups = new Map();
            for (const f of features) {
                const key = f.layer.id;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(f);
            }

            const blocks = [];
            for (const [layerId, feats] of groups) {
                const items = feats.map(f => {
                    const props = JSON.stringify(f.properties, null, 2);
                    const src = f.sourceLayer
                        ? `<div class="small text-muted">source-layer: <code>${escapeHtml(f.sourceLayer)}</code></div>`
                        : '';
                    return `<div class="mb-2">${src}<pre class="small mb-0">${escapeHtml(props)}</pre></div>`;
                }).join('');

                blocks.push(
                    `<details class="mb-2">` +
                    `<summary class="fw-semibold" style="cursor: pointer;">` +
                    `${escapeHtml(layerId)} ` +
                    `<span class="text-muted small">(${feats.length})</span>` +
                    `</summary>` +
                    `<div class="ps-2 mt-1">${items}</div>` +
                    `</details>`
                );
            }
            bodyEl.innerHTML = blocks.join('');
        }
        resultEl.classList.remove('d-none');
    });
}

// --- Geolocation + user's H3 cell -----------------------------------------

export function initGeolocate() {
    state.geolocate.on('geolocate', (position) => {
        const { latitude, longitude } = position.coords;
        const cell = h3.latLngToCell(latitude, longitude, H3_RES);
        const boundary = h3.cellToBoundary(cell, false).map(([lat, lng]) => [lng, lat]);
        boundary.push(boundary[0]);
        state.map.getSource('user-h3').setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [boundary] },
                properties: { h3: cell }
            }]
        });
        const html = `
            <div class="mb-1"><strong>Lat:</strong> ${latitude.toFixed(5)}</div>
            <div class="mb-1"><strong>Lng:</strong> ${longitude.toFixed(5)}</div>
            <div class="mb-1"><strong>H3 cell (res ${H3_RES}):</strong> <code class="small">${cell}</code></div>
        `;
        document.querySelectorAll('.user-location-info').forEach(el => { el.innerHTML = html; });
    });

    state.geolocate.on('error', () => {
        document.querySelectorAll('.user-location-info').forEach(el => {
            el.innerHTML = '<em class="text-warning-emphasis">Could not get your location.</em>';
        });
    });
}

// --- Zoom-adaptive H3 resolution ------------------------------------------

export function zoomToH3Res(zoom) {
    if (zoom < 6) return 4;
    if (zoom < 8) return 5;
    if (zoom < 10) return 6;
    if (zoom < 12) return 7;
    if (zoom < 14) return 8;
    if (zoom < 16) return 9;
    return 10;
}

// --- Mode tabs (Map / Saved) ----------------------------------------------

export function setMode(mode, onSavedActivate, onReportsActivate) {
    if (mode === 'layers') return;

    document.querySelectorAll('.app-tab, .dock-tab').forEach(t => {
        if (t.dataset.mode === 'layers') return;
        t.classList.toggle('active', t.dataset.mode === mode);
    });

    const savedPanel   = document.getElementById('savedPanel');
    const reportsPanel = document.getElementById('reportsPanel');

    savedPanel.classList.toggle('d-none', mode !== 'saved');
    reportsPanel.classList.toggle('d-none', mode !== 'reports');

    document.body.classList.toggle('list-mode', mode === 'saved' || mode === 'reports');

    if (mode === 'saved'   && onSavedActivate)   onSavedActivate();
    if (mode === 'reports' && onReportsActivate) onReportsActivate();
}

export function initModeTabs(onSavedActivate, onReportsActivate) {
    window.setMode = (mode) => setMode(mode, onSavedActivate, onReportsActivate);
    document.querySelectorAll('.app-tab, .dock-tab').forEach(tab => {
        tab.addEventListener('click', () => setMode(tab.dataset.mode, onSavedActivate, onReportsActivate));
    });
}