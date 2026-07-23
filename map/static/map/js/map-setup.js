// =============================================================================
// Map initialization, sources/layers, geolocation, query mode, mode tabs
// =============================================================================
//
// DEFERRED LAYER LOADING
// ----------------------
// On initial map load we register ONLY the layers a user sees immediately:
//   - terrain hillshade
//   - contours
//   - trails
//   - observations
// (The basemap roads/buildings/labels come from the MapLibre style JSON and
//  load independently of anything here.)
//
// Everything else — slope, aspect, canopy, tree species, burn severity,
// soil moisture, and hydrography — is registered lazily the first time the
// user toggles that group on. This keeps the initial map load fast.
//
// The mechanism: setLayerGroupVisibility() checks _registeredGroups; if the
// group hasn't been registered yet it calls the matching register*() function
// before flipping visibility. Each register*() is idempotent via the Set guard.
// =============================================================================

import {
    state,
    LAYER_IDS,
    BURN_SEVERITY_REGIONS,
    BURN_SEVERITY_ALL_YEARS,
    loadBurnSeverityYear,
    saveBurnSeverityYear,
    loadBurnSeverityPerimeterVisible,
    saveBurnSeverityPerimeterVisible,
} from './state.js';
import { escapeHtml } from './api.js';
import { registerSpeciesFilterProtocol } from './species-filter.js';

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

// Anchor layer from the basemap style that deferred layers insert beneath.
const BASEMAP_LINE_ANCHOR = 'tunnel-service-track-casing';

// CDN bases
const TERRAIN_BASE       = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/terrain';
const DERIVATIVES_BASE   = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/terrain/derivatives';
const CANOPY_BASE        = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/canopy';
const BURN_SEVERITY_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/burn-severity';
const SOIL_MOISTURE_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/soil-moisture';
const CONTOUR_BASE       = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/contours';

// Tracks which deferred groups have already had their sources+layers built.
const _registeredGroups = new Set();

// Maps a layer-group name (as used by the panel toggles + LAYER_IDS) to the
// registration function that lazily builds it. Groups NOT in this map are
// either registered eagerly at load (terrain, contour, trails, observations)
// or need no registration.
const DEFERRED_REGISTRARS = {
    'slope':                   registerSlope,
    'aspect':                  registerAspect,
    'tree-species':            registerTreeSpecies,
    'burn-severity':           registerBurnSeverity,
    'burn-severity-perimeter': registerBurnSeverity,
    'soil-moisture-raster':    registerSoilMoisture,
    'soil-moisture-isolines':  registerSoilMoisture,
    'hydrography':             registerHydrography,
};

// =============================================================================
// CENTRAL LAYER ORDERING
// =============================================================================
// Because deferred layers register in whatever order the user toggles them, we
// can't rely on insertion-time `beforeId` alone to get a stable stack. Instead
// we define the desired stacking of our overlay families ONCE (bottom → top)
// and re-assert it after every registration via enforceLayerOrder().
//
// Desired order, bottom to top:
//   1. terrain hillshade
//   2. slope / aspect (terrain derivatives)
//   3. contours (landscape feature, just above derivatives)
//   4. tree species / canopy (landscape vegetation)
//   5. soil moisture raster (broad translucent overlay)
//   6. burn severity rasters (data overlay)
//   7. trails
//   8. hydrography water (streams, waterbody fills/strokes)
//   9. soil moisture isolines
//  10. burn severity fire perimeters
//  11. hydrography labels (stream/waterbody text — must sit above overlays)
//
// Everything above lives BENEATH the basemap's place labels (BASEMAP_LINE_ANCHOR).
// Interaction highlights (nhd-hover-*, nhd-selected*) and observation pins are
// intentionally left ABOVE everything and are not managed here.

function isHydroWaterLayer(id) {
    // Real water geometry (not labels, not hover/selected highlights)
    return /^nhd-(ak|conus)-/.test(id) && !id.includes('label');
}

function isHydroLabelLayer(id) {
    return id.startsWith('nhd-') &&
           id.includes('label') &&
           !id.includes('selected') &&
           !id.includes('hover');
}

// Family predicates in bottom-to-top order. A layer is placed in the first
// family whose predicate it matches.
const LAYER_ORDER_FAMILIES = [
    id => id.endsWith('-hillshade'),                              // 1 terrain
    id => id.startsWith('slope-') || id.startsWith('aspect-'),   // 2 derivatives
    id => id.startsWith('contour-'),                             // 3 contours
    id => id.startsWith('tree-species') || id.startsWith('canopy-'), // 4 veg
    id => id === 'soil-moisture-raster-layer',                   // 5 soil moisture fill
    id => /^burn-severity-.*-layer$/.test(id),                   // 6 burn rasters
    id => id.startsWith('trails-'),                              // 7 trails
    id => isHydroWaterLayer(id),                                 // 8 water
    id => id === 'soil-moisture-isolines-layer',                 // 9 soil isolines
    id => id.startsWith('burn-severity-perimeters-'),           // 10 fire perimeters
    id => isHydroLabelLayer(id),                                 // 11 water labels
];

// Re-assert the desired stacking of all currently-registered overlay layers.
// Idempotent and cheap; safe to call after any registration.
function enforceLayerOrder() {
    const map = state.map;
    if (!map) return;

    const styleLayers = map.getStyle()?.layers;
    if (!styleLayers) return;
    const existingIds = styleLayers.map(l => l.id);

    // Collect the ids we manage, grouped by family, preserving each layer's
    // current relative order within its family.
    const buckets = LAYER_ORDER_FAMILIES.map(() => []);
    for (const id of existingIds) {
        for (let f = 0; f < LAYER_ORDER_FAMILIES.length; f++) {
            if (LAYER_ORDER_FAMILIES[f](id)) {
                buckets[f].push(id);
                break;
            }
        }
    }

    // Flatten bottom → top, then apply top → bottom so each layer is tucked
    // just beneath the one above it. Topmost managed layer sits directly beneath
    // the basemap place-label anchor.
    const bottomToTop = buckets.flat();
    const anchorExists = !!map.getLayer(BASEMAP_LINE_ANCHOR);
    let anchor = anchorExists ? BASEMAP_LINE_ANCHOR : undefined;

    for (let i = bottomToTop.length - 1; i >= 0; i--) {
        const id = bottomToTop[i];
        if (id === anchor) continue;
        try {
            map.moveLayer(id, anchor);   // place id just below `anchor`
            anchor = id;
        } catch (err) {
            // anchor may transiently not exist; skip — a later call re-fixes it.
        }
    }
}

// Ensure a deferred group's sources+layers exist. Safe to call repeatedly.
function ensureGroupRegistered(group) {
    const registrar = DEFERRED_REGISTRARS[group];
    if (!registrar) return;               // eager or unknown group — nothing to do
    if (_registeredGroups.has(group)) return;
    registrar();
    enforceLayerOrder();                  // normalize stacking after every build
}

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

    console.log('map-setup.js loaded — version 14 (deferred layers)');

    if (!state._pmtilesRegistered) {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        registerSpeciesFilterProtocol();
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
        state.map.on('load', async () => {
            addEagerSourcesAndLayers();
            enforceLayerOrder();
            wireHydroInteractions();
            wireTreeSpeciesHover();
            wireUrlSync();
            await preloadTreeSpeciesLegends();

            // Force a repaint once sources settle to unblock hillshade rendering
            state.map.once('idle', () => {
                state.map.triggerRepaint();
            });

            resolve();
        });
    });
}

// =============================================================================
// EAGER layers — registered immediately on load
// =============================================================================

function addEagerSourcesAndLayers() {
    registerTerrain();
    registerContours();
    registerTrails();
    registerObservations();
    registerCanopy();          
}

// --- Terrain hillshade (CONUS / AK / HI) ---------------------------------

function registerTerrain() {
    if (_registeredGroups.has('terrain')) return;
    const { map } = state;

    const terrainTiers = [
        { id: 'terrain-z3-4',   file: 'conus_z3-4_v1.pmtiles',   minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'terrain-z5-7',   file: 'conus_z5-7_v1.pmtiles',   minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'terrain-z8-10',  file: 'conus_z8-10_v1.pmtiles',  minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'terrain-z11-12', file: 'conus_z11-12_v1.pmtiles', minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 },
        { id: 'alaska-z3-4',    file: 'alaska_z3-4_v1.pmtiles',  minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'alaska-z5-7',    file: 'alaska_z5-7_v1.pmtiles',  minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'alaska-z8-10',   file: 'alaska_z8-10_v1.pmtiles', minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'alaska-z11-12',  file: 'alaska_z11-12_v1.pmtiles',minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 },
        { id: 'hawaii-z3-4',    file: 'hawaii_z3-4_v1.pmtiles',  minzoom: 3,  maxzoom: 5,  sourceMaxzoom: 4  },
        { id: 'hawaii-z5-7',    file: 'hawaii_z5-7_v1.pmtiles',  minzoom: 5,  maxzoom: 8,  sourceMaxzoom: 7  },
        { id: 'hawaii-z8-10',   file: 'hawaii_z8-10_v1.pmtiles', minzoom: 8,  maxzoom: 11, sourceMaxzoom: 10 },
        { id: 'hawaii-z11-12',  file: 'hawaii_z11-12_v1.pmtiles',minzoom: 11, maxzoom: 22, sourceMaxzoom: 12 },
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

    _registeredGroups.add('terrain');
}

// --- Contours (per-region, per-zoom tiers) -------------------------------

function registerContours() {
    if (_registeredGroups.has('contour')) return;
    const { map } = state;

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
            const file  = `${region}_contour_${interval}_z${tier.zoom}_v1.pmtiles`;

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

    _registeredGroups.add('contour');
}

// --- Trails (OSM path family — dedicated PMTiles) ------------------------

function registerTrails() {
    if (_registeredGroups.has('trails')) return;
    const { map } = state;

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

    _registeredGroups.add('trails');
}

// --- Observations (user pins) --------------------------------------------

function registerObservations() {
    if (_registeredGroups.has('observations')) return;
    const { map } = state;
    const empty = { type: 'FeatureCollection', features: [] };

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

    _registeredGroups.add('observations');
}

// =============================================================================
// DEFERRED layers — registered lazily on first toggle
// =============================================================================

// --- Terrain derivatives: slope (per-region) -----------------------------

function registerSlope() {
    if (_registeredGroups.has('slope')) return;
    const { map } = state;

    const slopeTiers = [
        { id: 'slope-conus',  file: 'slope_conus_z11-12_v1.pmtiles',  minzoom: 11, maxzoom: 22 },
        { id: 'slope-alaska', file: 'slope_alaska_z11-12_v1.pmtiles', minzoom: 11, maxzoom: 22 },
        { id: 'slope-hawaii', file: 'slope_hawaii_z11-12_v1.pmtiles', minzoom: 11, maxzoom: 22 }
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

    _registeredGroups.add('slope');
}

// --- Terrain derivatives: aspect (per-region) ----------------------------

function registerAspect() {
    if (_registeredGroups.has('aspect')) return;
    const { map } = state;

    const aspectTiers = [
        { id: 'aspect-conus',  file: 'aspect_conus_z11-12_v1.pmtiles',  minzoom: 11, maxzoom: 22 },
        { id: 'aspect-alaska', file: 'aspect_alaska_z11-12_v1.pmtiles', minzoom: 11, maxzoom: 22 },
        { id: 'aspect-hawaii', file: 'aspect_hawaii_z11-12_v1.pmtiles', minzoom: 11, maxzoom: 22 }
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

    _registeredGroups.add('aspect');
}

// --- Tree canopy cover ---------------------------------------------------

function registerCanopy() {
    if (_registeredGroups.has('canopy')) return;
    const { map } = state;

    [
        { id: 'canopy-conus',  file: 'conus_canopy_v1.pmtiles'  },
        { id: 'canopy-seak',   file: 'seak_canopy_v1.pmtiles'   },
        { id: 'canopy-hawaii', file: 'hawaii_canopy_v1.pmtiles'  }
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
        }, BASEMAP_LINE_ANCHOR);
    });

    _registeredGroups.add('canopy');
    enforceLayerOrder();
}

// --- Tree species (single-source, rendered from data tile) ---------------
// Only the data PMTiles is used — the speciesfilter:// protocol reads
// FORTYPCD/EVT codes from each pixel and colors them via the legend loaded
// at startup.

function registerTreeSpecies() {
    if (_registeredGroups.has('tree-species')) return;
    const { map } = state;

    [
        { id: 'tree-species',    region: 'conus', opacity: 0.40 },
        { id: 'tree-species-ak', region: 'ak',   opacity: 0.28 },
        { id: 'tree-species-hi', region: 'hi',   opacity: 0.28 },
    ].forEach(cfg => {
        map.addSource(cfg.id, {
            type: 'raster',
            tiles: [`speciesfilter://${cfg.region}/{z}/{x}/{y}`],
            tileSize: 256,
            minzoom: 4,
            maxzoom: 14,
        });
        map.addLayer({
            id: `${cfg.id}-layer`,
            type: 'raster',
            source: cfg.id,
            minzoom: 4,
            maxzoom: 22,
            paint: {
                'raster-opacity': cfg.opacity,
                'raster-resampling': 'nearest',
            },
            layout: { visibility: 'none' }
        }, BASEMAP_LINE_ANCHOR);
    });

    _registeredGroups.add('tree-species');
    enforceLayerOrder();
}

// --- Burn severity (MTBS annual mosaics + national perimeter vector) ------
// Covers both the 'burn-severity' and 'burn-severity-perimeter' groups.

function registerBurnSeverity() {
    if (_registeredGroups.has('burn-severity')) return;
    const { map } = state;

    Object.entries(BURN_SEVERITY_REGIONS).forEach(([region, years]) => {
        years.forEach(year => {
            const srcId = `burn-severity-${region}-${year}`;
            const layerId = `${srcId}-layer`;
            map.addSource(srcId, {
                type: 'raster',
                url: `pmtiles://${BURN_SEVERITY_BASE}/mtbs_${region}_${year}.pmtiles`,
                tileSize: 256,
                minzoom: 3,
                maxzoom: 12,
            });
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: srcId,
                minzoom: 3,
                maxzoom: 22,
                paint: {
                    'raster-opacity': 0.4,
                    'raster-resampling': 'nearest',
                },
                layout: { visibility: 'none' }
            }, BASEMAP_LINE_ANCHOR);
        });
    });

    // Fire perimeters (national vector)
    map.addSource('burn-severity-perimeters', {
        type: 'vector',
        url: `pmtiles://${BURN_SEVERITY_BASE}/mtbs_perimeters.pmtiles`,
    });

    // Outer halo — soft, blurred, low opacity
    map.addLayer({
        id: 'burn-severity-perimeters-halo',
        type: 'line',
        source: 'burn-severity-perimeters',
        'source-layer': 'perimeters',
        minzoom: 3,
        maxzoom: 22,
        paint: {
            'line-color': '#ff6b35',
            'line-width': ['interpolate', ['linear'], ['zoom'],
                3, 3,
                6, 5,
                10, 8,
                14, 12,
            ],
            'line-opacity': 0.4,
            'line-blur': 4,
        },
        layout: { visibility: 'none' }
    }, BASEMAP_LINE_ANCHOR);

    // Crisp inner stroke — the actual perimeter
    map.addLayer({
        id: 'burn-severity-perimeters-line',
        type: 'line',
        source: 'burn-severity-perimeters',
        'source-layer': 'perimeters',
        minzoom: 3,
        maxzoom: 22,
        paint: {
            'line-color': '#c8422e',
            'line-width': ['interpolate', ['linear'], ['zoom'],
                3, 1.0,
                6, 1.6,
                10, 2.4,
                14, 3.2,
            ],
            'line-opacity': 0.95,
        },
        layout: { visibility: 'none' }
    }, BASEMAP_LINE_ANCHOR);

    _registeredGroups.add('burn-severity');
    _registeredGroups.add('burn-severity-perimeter');

    // The year picker + perimeter toggles may have been initialized before
    // these layers existed; re-apply saved state now that they're present.
    applyBurnSeverityInitialState();
}

// --- Soil moisture (ERA5 daily, raster + isolines) -----------------------
// Covers both the 'soil-moisture-raster' and 'soil-moisture-isolines' groups.

function registerSoilMoisture() {
    if (_registeredGroups.has('soil-moisture-raster')) return;
    const { map } = state;

    map.addSource('soil-moisture-raster', {
        type: 'raster',
        url: `pmtiles://${SOIL_MOISTURE_BASE}/raster/era5_raster_latest.pmtiles`,
        tileSize: 256,
        minzoom: 3,
        maxzoom: 8,
    });
    map.addLayer({
        id: 'soil-moisture-raster-layer',
        type: 'raster',
        source: 'soil-moisture-raster',
        minzoom: 3,
        maxzoom: 22,
        paint: {
            'raster-opacity': 0.35,
            'raster-resampling': 'linear',
        },
        layout: { visibility: 'none' }
    }, BASEMAP_LINE_ANCHOR);

    map.addSource('soil-moisture-isolines', {
        type: 'vector',
        url: `pmtiles://${SOIL_MOISTURE_BASE}/isolines/era5_isolines_latest.pmtiles`,
    });
    map.addLayer({
        id: 'soil-moisture-isolines-layer',
        type: 'line',
        source: 'soil-moisture-isolines',
        'source-layer': 'isolines',
        minzoom: 3,
        maxzoom: 22,
        paint: {
            'line-color': [
                'interpolate', ['linear'],
                ['get', 'soil_moisture'],
                0.0,  '#ffffe5',
                0.15, '#78c679',
                0.30, '#1d91c0',
                0.50, '#0c2c84',
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'],
                3, 0.5,
                6, 0.8,
                8, 1.2,
            ],
            'line-opacity': 0.8,
        },
        layout: { visibility: 'none' }
    }, BASEMAP_LINE_ANCHOR);

    _registeredGroups.add('soil-moisture-raster');
    _registeredGroups.add('soil-moisture-isolines');
}

// --- Hydrography (NHD: CONUS+HI, Alaska, + Protomaps labels) --------------

function registerHydrography() {
    if (_registeredGroups.has('hydrography')) return;
    const { map } = state;
    const empty = { type: 'FeatureCollection', features: [] };

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

    // Protomaps hydro (used for CONUS labels + hover/select source features)
    map.addSource('nhd', {
        type: 'vector',
        url: 'pmtiles://https://protomaps-example.s3.us-west-2.amazonaws.com/us_hydro.pmtiles'
    });

    map.addSource('nhd-hover',    { type: 'geojson', data: empty });
    map.addSource('nhd-selected', { type: 'geojson', data: empty });

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

    // Selected + hover highlight layers (driven by geojson sources)
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

    _registeredGroups.add('hydrography');

    // Hydrography just inserted its layers beneath BASEMAP_LINE_ANCHOR, which is
    // above any landscape layers registered earlier. Push landscape layers back
    // down below the water so tree species / canopy don't cover lakes & streams.
    enforceLayerOrder();
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

const WATERBODY_FTYPE_LABELS = {
    390: 'Lake/Pond', 436: 'Reservoir', 361: 'Playa',
    378: 'Ice mass', 466: 'Swamp/Marsh'
};
const AREA_FTYPE_LABELS = {
    460: 'Stream/River', 537: 'Sea/Ocean', 312: 'Bay/Inlet',
    445: 'Rapids', 487: 'Wash'
};

function hydroFeatureTitle(feature) {
    const p = feature.properties || {};
    if (p.gnis_name) return p.gnis_name;
    const kind = featureKind(feature);
    if (kind === 'stream') return 'Unnamed waterway';
    if (kind === 'area') return 'Unnamed water';
    return 'Unnamed lake';
}

function wrapInfoRows(rows) {
    return rows.map(([k, v]) =>
        `<div class="small d-flex justify-content-between gap-3">` +
        `<span class="text-muted">${escapeHtml(String(k))}</span>` +
        `<span><code>${escapeHtml(String(v))}</code></span>` +
        `</div>`
    ).join('');
}

function streamInfoRowsHtml(feature) {
    const p = feature.properties || {};
    const rows = [];

    if (p.max_strahler != null) rows.push(['Stream order', p.max_strahler]);

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

    const flow = fmtNumber(p.avg_flow_cfs, 1);
    if (flow !== null) rows.push(['Avg flow', `${flow} cfs`]);
    const slope = fmtNumber(p.avg_slope, 4);
    if (slope !== null) rows.push(['Avg gradient', `${(Number(slope) * 100).toFixed(2)}%`]);
    if (p.segment_count != null) rows.push(['NHD segments', p.segment_count]);
    if (p.gnis_id) rows.push(['GNIS ID', p.gnis_id]);

    return wrapInfoRows(rows);
}

function waterbodyInfoRowsHtml(feature, isArea) {
    const p = feature.properties || {};
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

    return wrapInfoRows(rows);
}

function hydroInfoRowsHtml(feature) {
    const kind = featureKind(feature);
    if (kind === 'stream') return streamInfoRowsHtml(feature);
    if (kind === 'area') return waterbodyInfoRowsHtml(feature, true);
    return waterbodyInfoRowsHtml(feature, false);
}

function renderCommentRow(c, currentUsername) {
    const when = new Date(c.created_at).toLocaleDateString();
    const isPrivate = c.is_public === false;
    const initials = (c.username || '?').slice(0, 2);
    const mine = currentUsername && c.username === currentUsername;
    const editLink = mine
        ? `<button class="btn btn-link btn-sm p-0 ms-1 hydro-comment-edit"
                   data-comment-id="${escapeHtml(c.id)}"
                   style="font-size:0.7rem;">edit</button>`
        : '';
    const privateBadge = isPrivate
        ? ' <span class="badge" style="font-size:0.6rem;background:var(--brand-orange);">private</span>'
        : '';

    return `<div class="hydro-comment-row${isPrivate ? ' is-private' : ''}" data-comment-id="${escapeHtml(c.id)}">
        <div class="hydro-comment-avatar">${escapeHtml(initials)}</div>
        <div class="hydro-comment-content">
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
        </div>
    </div>`;
}

function wireHydroInfoComments(containerEl, gnisId, gnisName, lngLat, feature) {
    if (!gnisId) return;

    const listEl    = containerEl.querySelector('.hydro-comments-list');
    const input     = containerEl.querySelector('.hydro-comment-input');
    const publicChk = containerEl.querySelector('.hydro-comment-public');
    const submitBtn = containerEl.querySelector('.hydro-comment-submit');
    const errEl     = containerEl.querySelector('.hydro-comment-error');

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
            listEl.innerHTML = comments.map(c => renderCommentRow(c, currentUsername)).join('');
            wireCommentRowActions(listEl);
        } catch {
            listEl.innerHTML = '<span class="text-danger">Could not load comments.</span>';
        }
    }

    function wireCommentRowActions(scopeEl) {
        scopeEl.querySelectorAll('.hydro-comment-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.hydro-comment-row');
                row.querySelector('.hydro-comment-display').classList.add('d-none');
                row.querySelector('.hydro-comment-edit-form').classList.remove('d-none');
            });
        });
        scopeEl.querySelectorAll('.hydro-comment-edit-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.hydro-comment-row');
                row.querySelector('.hydro-comment-edit-form').classList.add('d-none');
                row.querySelector('.hydro-comment-display').classList.remove('d-none');
            });
        });
        scopeEl.querySelectorAll('.hydro-comment-edit-save').forEach(btn => {
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
                    const { apiFetch } = await import('./api.js');
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
            const { apiFetch } = await import('./api.js');
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

    loadComments();
}

let infoPanelCloseHandler = null;

export function closeInfoPanel() {
    document.getElementById('sidePanelInfo')?.classList.add('d-none');
    document.body.classList.remove('info-panel-open');   // ← add this line
    const offcanvasEl = document.getElementById('hydroInfoSheet');
    if (offcanvasEl) {
        const instance = bootstrap.Offcanvas.getInstance(offcanvasEl);
        if (instance) instance.hide();
    }
    if (infoPanelCloseHandler) {
        const handler = infoPanelCloseHandler;
        infoPanelCloseHandler = null;
        handler();
    }
}

export function showInfoPanel({ title, bodyHtml, onClose }) {
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;

    if (isDesktop && typeof window.setMode === 'function') {
        window.setMode('map');   // close Saved/Reports first, firing THEIR previous close handler
    }

    infoPanelCloseHandler = onClose || null;

    if (isDesktop) {
        const panel = document.getElementById('sidePanelInfo');
        const titleEl = document.getElementById('sidePanelInfoTitle');
        const bodyEl = document.getElementById('sidePanelInfoBody');
        if (!panel || !titleEl || !bodyEl) return null;
        titleEl.textContent = title;
        bodyEl.innerHTML = bodyHtml;
        panel.classList.remove('d-none');
        document.body.classList.add('info-panel-open');
        return bodyEl;
    } else {
        const sheetEl = document.getElementById('hydroInfoSheet');
        const titleEl = document.getElementById('hydroInfoSheetLabel');
        const bodyEl = document.getElementById('hydroInfoSheetBody');
        if (!sheetEl || !titleEl || !bodyEl) return null;
        titleEl.textContent = title;
        bodyEl.innerHTML = bodyHtml;
        const instance = bootstrap.Offcanvas.getOrCreateInstance(sheetEl);
        instance.show();
        return bodyEl;
    }
}

function initInfoPanelUI() {
    document.getElementById('sidePanelInfoClose')?.addEventListener('click', closeInfoPanel);
    const offcanvasEl = document.getElementById('hydroInfoSheet');
    offcanvasEl?.addEventListener('hidden.bs.offcanvas', () => {
        if (infoPanelCloseHandler) {
            const handler = infoPanelCloseHandler;
            infoPanelCloseHandler = null;
            handler();
        }
    });
}

function showHydroInfo(feature, lngLat) {
    const p = feature.properties || {};
    const gnisId = p.gnis_id || null;
    const gnisName = p.gnis_name || '';
    const title = hydroFeatureTitle(feature);
    const rowsHtml = hydroInfoRowsHtml(feature);

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

    const bodyHtml = `<div class="hydro-info">${rowsHtml}${commentsHtml}</div>`;

    const bodyEl = showInfoPanel({
        title,
        bodyHtml,
        onClose: () => { clearSelectedHydro(); },
    });
    if (bodyEl) {
        wireHydroInfoComments(bodyEl, gnisId, gnisName, lngLat, feature);
    }
}

function wireHydroInteractions() {
    const map = state.map;
    let lastHoveredKey = null;

    initInfoPanelUI();

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
            closeInfoPanel();
            return;
        }
        setSelectedHydro(findAllFragments(feat));
        showHydroInfo(feat, e.lngLat);
    });
}

// =============================================================================
// Tree species hover lookup (CONUS / AK / HI)
// =============================================================================

const TREE_SPECIES_REGIONS = [
    {
        name: 'conus',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus_v1.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus_data_v1.pmtiles',
        legendUrl:      'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/treemap_composite_conus_legend.json',
        bbox: [-125.5, 24.0, -66.0, 50.0],
        lookupType: 'data-tile',
        maxZoom: 14,
    },
    {
        name: 'ak',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak_v1.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak_data_v1.pmtiles',
        legendUrl:      'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_ak_legend.json',
        bbox: [-180.0, 51.0, -129.0, 72.0],
        lookupType: 'data-tile',
        maxZoom: 14,
    },
    {
        name: 'hi',
        pmtilesUrl:     'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_hi_v1.pmtiles',
        dataPmtilesUrl: 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-species/landfire_evt_hi_data_v1.pmtiles',
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
        lookupByFortypcd: null,
        lookupByAlpha: null,
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
            s.lookupByFortypcd = new Map();
            const src = raw.by_fortypcd || raw.by_evt_code || raw;
            for (const [code, info] of Object.entries(src)) {
                s.lookupByFortypcd.set(code, info);
            }
        } else {
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
    if (!s.dataPmtiles) return null;

    const z = Math.min(region.maxZoom, Math.floor(state.map.getZoom()));
    const { x, y, px, py } = lngLatToTilePixel(lngLat.lng, lngLat.lat, z);

    const dataImg = await fetchAndCacheTile(s.dataPmtiles, s.dataTileCache, z, x, y);
    if (!dataImg) return null;

    const idx = (py * 256 + px) * 4;
    const code = (dataImg.data[idx] << 8) | dataImg.data[idx + 1];
    if (code === 0) return null;

    if (state.treeSpeciesSelection && state.treeSpeciesSelection.size > 0) {
        const key = `${region.name}:${code}`;
        if (!state.treeSpeciesSelection.has(key)) return null;
    }

    const preloaded = state.treeSpeciesLegends?.[region.name];
    if (preloaded) {
        const info = preloaded.get(code);
        if (info) return info;
    }
    return s.lookupByFortypcd ? (s.lookupByFortypcd.get(String(code)) || null) : null;
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

// -----------------------------------------------------------------------------
// Exports for species picker + speciesfilter:// protocol
// -----------------------------------------------------------------------------

async function preloadTreeSpeciesLegends() {
    await Promise.all(TREE_SPECIES_REGIONS.map(async (region) => {
        try {
            const resp = await fetch(region.legendUrl);
            const raw = await resp.json();
            const src = raw.by_fortypcd || raw.by_evt_code || raw;
            const m = new Map();
            for (const [code, info] of Object.entries(src)) {
                if (!info || !info.hex) continue;
                m.set(parseInt(code, 10), info);
            }
            state.treeSpeciesLegends[region.name] = m;
        } catch (err) {
            console.warn(`Legend preload failed for ${region.name}:`, err);
            state.treeSpeciesLegends[region.name] = new Map();
        }
    }));
}

export function getTreeSpeciesRegions() {
    return TREE_SPECIES_REGIONS;
}

export function getRegionByName(name) {
    return TREE_SPECIES_REGIONS.find(r => r.name === name) || null;
}

export function getRegionPmtilesForFilter(region) {
    const s = getRegionState(region);
    return { display: s.pmtiles, data: s.dataPmtiles };
}

export function reloadSpeciesFilterSources() {
    const map = state.map;
    if (!map) return;
    const stamp = Date.now();
    [
        { id: 'tree-species',    region: 'conus' },
        { id: 'tree-species-ak', region: 'ak' },
        { id: 'tree-species-hi', region: 'hi' },
    ].forEach(cfg => {
        const src = map.getSource(cfg.id);
        if (!src) return;
        src.setTiles([`speciesfilter://${cfg.region}/{z}/{x}/{y}?v=${stamp}`]);
    });
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
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lngs)];
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
    // Lazily build the group's sources+layers the first time it's switched on.
    if (visible) {
        ensureGroupRegistered(group);
    }

    // Burn severity: only ONE year visible at a time
    if (group === 'burn-severity') {
        if (visible) {
            const year = state.burnSeverityYear ?? BURN_SEVERITY_ALL_YEARS[0];
            setBurnSeverityYear(year);
        } else {
            hideBurnSeverityRasters();
        }
        return;
    }

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

        const html = `
            <div class="mb-1"><strong>Lat:</strong> ${latitude.toFixed(5)}</div>
            <div class="mb-1"><strong>Lng:</strong> ${longitude.toFixed(5)}</div>
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

    closeInfoPanel();    // ← add this line

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

// -----------------------------------------------------------------------------
// Burn severity year picker + perimeter toggle
// -----------------------------------------------------------------------------

// Show a single year across all regions where data exists.
// Turns off all other burn severity raster layers.
export function setBurnSeverityYear(year) {
    const map = state.map;
    if (!map) return;

    // Ensure the burn severity layers exist before trying to toggle them.
    ensureGroupRegistered('burn-severity');

    state.burnSeverityYear = year;
    saveBurnSeverityYear(year);

    // Toggle raster visibility per year
    Object.entries(BURN_SEVERITY_REGIONS).forEach(([region, years]) => {
        years.forEach(y => {
            const layerId = `burn-severity-${region}-${y}-layer`;
            if (!map.getLayer(layerId)) return;
            const visible = (y === year);
            map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        });
    });

    // Perimeters always follow the selected year.
    applyPerimeterFilter();
}

export function hideBurnSeverityRasters() {
    const map = state.map;
    if (!map) return;
    Object.entries(BURN_SEVERITY_REGIONS).forEach(([region, years]) => {
        years.forEach(y => {
            const layerId = `burn-severity-${region}-${y}-layer`;
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', 'none');
            }
        });
    });
}

export function setBurnSeverityPerimeterVisible(visible) {
    const map = state.map;
    if (!map) return;

    // Ensure the perimeter layer exists before toggling.
    if (visible) ensureGroupRegistered('burn-severity-perimeter');

    state.burnSeverityPerimeterVisible = visible;
    saveBurnSeverityPerimeterVisible(visible);
    if (map.getLayer('burn-severity-perimeters-line')) {
        map.setLayoutProperty('burn-severity-perimeters-line',
            'visibility', visible ? 'visible' : 'none');
    }
}

// Filter the perimeter layer to the currently selected burn-severity year.
// ig_date is stored as an ISO-ish string starting with "YYYY-...".
function applyPerimeterFilter() {
    const map = state.map;
    if (!map || !map.getLayer('burn-severity-perimeters-line')) return;

    if (state.burnSeverityYear != null) {
        const yearPrefix = String(state.burnSeverityYear);
        map.setFilter('burn-severity-perimeters-line', [
            '==',
            ['slice', ['get', 'ig_date'], 0, 4],
            yearPrefix,
        ]);
    } else {
        map.setFilter('burn-severity-perimeters-line', null);
    }
}



// Applies saved burn-severity UI state to freshly-registered layers. Called
// from registerBurnSeverity() so that if the user had a perimeter toggle etc.
// saved, it's reflected once the layers actually exist.
function applyBurnSeverityInitialState() {
    const map = state.map;
    if (!map) return;

    // If the perimeter was toggled on in the UI, show it now.
    if (state.burnSeverityPerimeterVisible && map.getLayer('burn-severity-perimeters-line')) {
        map.setLayoutProperty('burn-severity-perimeters-line', 'visibility', 'visible');
    }
    applyPerimeterFilter();
}

export function initBurnSeverityControls() {
    const selects = document.querySelectorAll('.burn-severity-year-select');
    const savedYear = loadBurnSeverityYear() ?? BURN_SEVERITY_ALL_YEARS[0];
    const options = BURN_SEVERITY_ALL_YEARS
        .map(y => `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y}</option>`)
        .join('');

    selects.forEach(sel => {
        sel.innerHTML = options;
        sel.addEventListener('change', (e) => {
            const year = parseInt(e.target.value, 10);
            selects.forEach(other => { if (other !== e.target) other.value = String(year); });

            // Check if ANY burn severity layer is currently visible.
            // Can't use isLayerGroupVisible here because that checks only the
            // first layer in the group, and only one year is on at a time.
            const anyVisible = LAYER_IDS['burn-severity'].some(id => {
                return state.map.getLayer(id) &&
                       state.map.getLayoutProperty(id, 'visibility') === 'visible';
            });

            if (anyVisible) {
                setBurnSeverityYear(year);
            } else {
                state.burnSeverityYear = year;
                saveBurnSeverityYear(year);
                // Even if rasters are off, if the perimeter is on we still want
                // it to re-filter to the newly selected year.
                applyPerimeterFilter();
            }
        });
    });

    state.burnSeverityYear = savedYear;

    // Perimeter visibility toggle
    const perimVisible = false;
    const perimToggles = document.querySelectorAll('.burn-severity-perimeter-toggle');
    perimToggles.forEach(cb => {
        cb.checked = perimVisible;
        cb.addEventListener('change', (e) => {
            const on = e.target.checked;
            perimToggles.forEach(other => { if (other !== e.target) other.checked = on; });
            setBurnSeverityPerimeterVisible(on);
        });
    });

    // NOTE: we intentionally do NOT eagerly show the perimeter here even if
    // perimVisible is true — the burn severity layers are deferred and will be
    // built + have their saved state applied the first time the group is
    // registered (see applyBurnSeverityInitialState). If you want a saved
    // "perimeter on" state to restore the layers at load, uncomment:
    //
    // if (perimVisible) setBurnSeverityPerimeterVisible(true);
}

export function initSoilMoistureControls() {
    // Nothing needed for now — toggles handled by initLayerPanels, layers
    // registered lazily on first toggle. Future: date picker for the archive.
}