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
        // replaceState rather than location.hash assignment: no per-pan history
        // entry, and no 'hashchange' event firing back at us.
        window.history.replaceState(null, '', hash);
    };

    state.map.on('moveend', update);
    // Write the initial hash so a fresh load immediately has a shareable URL.
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
        mapOpts.center = [hashState.lng, hashState.lat]; // MapLibre wants [lng, lat]
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
            wireUrlSync();
            resolve();
        });
    });
}

// --- Sources and layers ---------------------------------------------------

function addSourcesAndLayers() {
    const { map } = state;
    const empty = { type: 'FeatureCollection', features: [] };

    // Anchor for inserting our terrain layers into Bright's stack.
    // Everything inserted before this id renders beneath Bright's transportation,
    // railway, bridge, label, and POI layers — but on top of Bright's landcover,
    // landuse, water, and buildings. That places hillshade and contours where
    // they cartographically belong: above the fills, below the lines.
    const BASEMAP_LINE_ANCHOR = 'tunnel-service-track-casing';

    // --- Terrain hillshade (CONUS) ------------------------------------
    // Four resolution tiers, each scoped to the zoom range it was encoded for.
    const TERRAIN_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/terrain';

    const terrainTiers = [
        { id: 'terrain-z3-4',   file: 'conus_z3-4.pmtiles',   minzoom: 3,  maxzoom: 5  },
        { id: 'terrain-z5-7',   file: 'conus_z5-7.pmtiles',   minzoom: 5,  maxzoom: 8  },
        { id: 'terrain-z8-10',  file: 'conus_z8-10.pmtiles',  minzoom: 8,  maxzoom: 11 },
        { id: 'terrain-z11-12', file: 'conus_z11-12.pmtiles', minzoom: 11, maxzoom: 15 },
        { id: 'alaska-z3-4',   file: 'alaska_z3-4.pmtiles',   minzoom: 3,  maxzoom: 5  },
        { id: 'alaska-z5-7',   file: 'alaska_z5-7.pmtiles',   minzoom: 5,  maxzoom: 8  },
        { id: 'alaska-z8-10',  file: 'alaska_z8-10.pmtiles',  minzoom: 8,  maxzoom: 11 },
        { id: 'alaska-z11-12', file: 'alaska_z11-12.pmtiles', minzoom: 11, maxzoom: 15 },
        { id: 'hawaii-z3-4',   file: 'hawaii_z3-4.pmtiles',   minzoom: 3,  maxzoom: 5  },
        { id: 'hawaii-z5-7',   file: 'hawaii_z5-7.pmtiles',   minzoom: 5,  maxzoom: 8  },
        { id: 'hawaii-z8-10',  file: 'hawaii_z8-10.pmtiles',  minzoom: 8,  maxzoom: 11 },
        { id: 'hawaii-z11-12', file: 'hawaii_z11-12.pmtiles', minzoom: 11, maxzoom: 15 }
    ];

    terrainTiers.forEach(tier => {
        map.addSource(tier.id, {
            type: 'raster-dem',
            url: `pmtiles://${TERRAIN_BASE}/${tier.file}`,
            encoding: 'mapbox',
            tileSize: 512
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
/*
    // --- Terrain edge mask: hides hillshade outside US data coverage ---
    map.addSource('us-mask', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/masks/us_mask.pmtiles'
    });
    map.addLayer({
        id: 'us-mask-fill',
        type: 'fill',
        source: 'us-mask',
        'source-layer': 'mask',
        paint: {
            'fill-color': '#a9d3e0',
            'fill-opacity': 1
        }
    });
*/
    // --- Contours (per-region, per-zoom tiers) ------------------------
    // Each region has single-zoom tiers; the contour interval coarsens as you
    // zoom out so dense terrain stays readable. Files follow the convention
    //   {region}_contour_{interval}_{zoom}.pmtiles
    // matching the per-region hillshade pattern above. Tiers whose files are
    // not yet uploaded simply won't render — adding them later is just an
    // upload, no code change.
    //
    // Zoom ladder (interval / index):
    //   z13+  50ft / 250ft   (10m DEM)  -- detail floor, overzooms to 15
    //   z12  100ft / 500ft   (10m DEM)
    //   z11  150ft / 750ft   (30m DEM)
    //   z10  250ft / 1000ft  (30m DEM)
    //   z9   500ft / 2500ft  (100m DEM)
    //   z8   750ft / 3000ft  (100m DEM)
    const CONTOUR_BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/contours';
    const CONTOUR_REGION_INTERVALS = {
        hawaii: { 8: '750ft', 9: '500ft', 10: '250ft', 11: '150ft', 12: '100ft', 13: '50ft' },
        alaska: { 8: '1000ft', 9: '500ft', 10: '400ft', 11: '200ft', 12: '200ft', 13: '100ft' },
        conus:  { 8: '750ft', 9: '500ft', 10: '250ft', 11: '150ft', 12: '100ft', 13: '50ft' }
    };

    const CONTOUR_ZOOM_TIERS = [
        { zoom: 8,  minzoom: 8,  maxzoom: 9,  wIntermediate: 0.6, wIndex: 1.0 },
        { zoom: 9,  minzoom: 9,  maxzoom: 10, wIntermediate: 0.6, wIndex: 1.0 },
        { zoom: 10, minzoom: 10, maxzoom: 11, wIntermediate: 0.6, wIndex: 1.1 },
        { zoom: 11, minzoom: 11, maxzoom: 12, wIntermediate: 0.7, wIndex: 1.1 },
        { zoom: 12, minzoom: 12, maxzoom: 13, wIntermediate: 0.7, wIndex: 1.2 },
        { zoom: 13, minzoom: 13, maxzoom: 15, wIntermediate: 0.8, wIndex: 1.2 }
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

            // Intermediate lines (thin) — idx = 0
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

            // Index lines (thick) — idx = 1
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
    
    // --- Trails (OSM path family, extracted to dedicated PMTiles) ----
    // Data floors at z11 by build (tippecanoe --minimum-zoom=11). Source-layer
    // is named 'trails', containing highway=path/track/footway/bridleway/
    // cycleway/steps. No class/subclass filter needed — the tileset is
    // already only trails by construction.
    map.addSource('trails', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/trails/trails-na-20260524.pmtiles'
    });

    map.addLayer({
        id: 'trails-line',
        type: 'line',
        source: 'trails',
        'source-layer': 'trails',
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
            'line-color': '#1f6b3a',
            'line-width': [
                'interpolate', ['exponential', 1.4], ['zoom'],
                11, 1.2, 12, 2.0, 15, 3.5, 18, 5.5
            ],
            'line-dasharray': [1.5, 1.5],
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

    // --- 1. Line hover halo -------------------------------------------
    map.addLayer({
        id: 'nhd-hover-halo',
        type: 'line',
        source: 'nhd-hover',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
            'line-color': HOVER_COLOR,
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4, 6, 10, 12, 14, 20, 17, 30
            ],
            'line-opacity': 0.75,
            'line-blur': 4
        }
    });

    // --- 2. Streams ---------------------------------------------------
    map.addLayer({
        id: 'nhd-streams',
        type: 'line',
        source: 'nhd',
        'source-layer': 'streams',
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': widthByStrahler,
            'line-opacity': 0.95
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
    });

    // --- 3. Areas fill / stroke ---------------------------------------
    map.addLayer({
        id: 'nhd-areas-fill',
        type: 'fill',
        source: 'nhd',
        'source-layer': 'areas',
        paint: { 'fill-color': WATER_FILL, 'fill-opacity': 0.95 }
    });
    map.addLayer({
        id: 'nhd-areas-stroke',
        type: 'line',
        source: 'nhd',
        'source-layer': 'areas',
        paint: { 'line-color': STREAM_COLOR, 'line-width': 0.8, 'line-opacity': 0.85 }
    });

    // --- 4. Waterbodies fill / stroke ---------------------------------
    map.addLayer({
        id: 'nhd-waterbodies-fill',
        type: 'fill',
        source: 'nhd',
        'source-layer': 'waterbodies',
        paint: { 'fill-color': WATER_FILL, 'fill-opacity': 0.95 }
    });
    map.addLayer({
        id: 'nhd-waterbodies-stroke',
        type: 'line',
        source: 'nhd',
        'source-layer': 'waterbodies',
        paint: { 'line-color': STREAM_COLOR, 'line-width': 0.8, 'line-opacity': 0.9 }
    });

    // --- 5. Polygon hover (OVER lakes) --------------------------------
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

    // --- 6. Selected line (streams) -----------------------------------
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

    // --- 7. Selected polygon (lakes) ----------------------------------
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

    // --- 8. Stream labels - large -------------------------------------
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
    });

    // --- 9. Stream labels - medium ------------------------------------
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
    });

    // --- 10. Stream labels - small ------------------------------------
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
    });

    // --- 11. Waterbody labels ----------------------------------------
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
    });

    // ====================================================================
    // ALASKA HYDROGRAPHY (separate PMTiles, drainage-area-based styling)
    // ====================================================================
    // CONUS uses Strahler order (rank, 1-10). AK has no Strahler in NHD —
    // we computed drainage area from a DEM flow accumulation instead.
    // Width expression is log-scaled because drainage area spans 5 orders
    // of magnitude (headwater ~0.01 km² → Yukon ~477,000 km²).
    //
    // Layer names: nhd-ak-*  — referenced by LAYER_IDS.nhd_ak in state.js
    // and toggled independently via the "Alaska hydrography" switch.

    map.addSource('nhd_ak', {
        type: 'vector',
        //url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/nhd/nhd_ak.pmtiles'
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/nhd/nhd_ak_v5.pmtiles',
        maxzoom: 13
    });

    // Log10-scaled width by drainage area. max(1, ...) avoids log of 0/null.
    // log10(1) = 0 (tiny creek), log10(477000) ≈ 5.7 (Yukon mainstem).
    const widthByDrainage = [
        'interpolate', ['linear'], ['zoom'],
        4,  ['*', 0.25, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        8,  ['*', 0.45, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        12, ['*', 0.80, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        16, ['*', 1.40, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]],
        19, ['*', 2.20, ['log10', ['max', 1, ['to-number', ['get', 'max_totdasqkm']]]]]
    ];

    // --- AK streams ---------------------------------------------------
    map.addLayer({
        id: 'nhd-ak-streams',
        type: 'line',
        source: 'nhd_ak',
        'source-layer': 'streams',
        filter: ['any',
            ['has', 'gnis_name'],
            ['>=', ['to-number', ['get', 'max_totdasqkm']], 100]
        ],
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': widthByDrainage,
            'line-opacity': 0.95
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' }
    });

    // --- AK waterbodies fill / stroke ---------------------------------
    map.addLayer({
        id: 'nhd-ak-waterbodies-fill',
        type: 'fill',
        source: 'nhd_ak',
        'source-layer': 'waterbodies',
        paint: { 'fill-color': WATER_FILL, 'fill-opacity': 0.95 }
    });
    map.addLayer({
        id: 'nhd-ak-waterbodies-stroke',
        type: 'line',
        source: 'nhd_ak',
        'source-layer': 'waterbodies',
        paint: { 'line-color': STREAM_COLOR, 'line-width': 0.8, 'line-opacity': 0.9 }
    });

    // --- AK stream labels: three tiers, one per pre-simplified source-layer
    // Each source-layer was simplified at a different tolerance during the
    // pipeline (0.1° / 0.01° / 0.002°) so labels lay cleanly along the line
    // at each zoom range.
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
    });

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
    });

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
    });

    // --- AK waterbody labels ------------------------------------------
    map.addLayer({
        id: 'nhd-ak-waterbodies-label',
        type: 'symbol',
        source: 'nhd_ak',
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
    });

    // --- 12. Selected-feature label (line, for streams) ---------------
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

    // --- 12b. Selected-feature label (point, for lakes) ---------------
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

// Removed nhd-areas-fill — those polygons span multiple drainages and clicking
// them was producing confusing selections. Click passes through to whatever
// stream is underneath instead.
const HYDRO_INTERACTIVE_LAYERS = [
    'nhd-waterbodies-fill',
    'nhd-streams'
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

// MapLibre v5 rejects non-plain feature objects (and turf's class-y output)
// when passed to geojson setData. Deep-clone to plain GeoJSON first.
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

// Find every feature with this gnis_id in the same source-layer. For polygon
// layers, union the matched geometries with Turf so the highlight renders as
// one unified shape with one label (instead of N separate fragments each
// getting their own label placement).
function findAllFragments(clickedFeature) {
    const map = state.map;
    const gnisId = clickedFeature.properties?.gnis_id;
    if (!gnisId) return [clickedFeature];

    const layerId = clickedFeature.layer?.id;
    let sourceLayer;
    if (layerId === 'nhd-streams') sourceLayer = 'streams';
    else if (layerId === 'nhd-waterbodies-fill') sourceLayer = 'waterbodies';
    else if (layerId === 'nhd-areas-fill') sourceLayer = 'areas';
    else return [clickedFeature];

    const matches = map.querySourceFeatures('nhd', {
        sourceLayer,
        filter: ['==', ['get', 'gnis_id'], gnisId]
    });

    if (!matches.length) return [clickedFeature];

    // Polygon layers: union into single feature so we get one label / one
    // continuous outline. Lines: keep all fragments — line highlight benefits
    // from per-tile precision.
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
            // Union can fail on invalid geometries — fall back to fragments
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
    if (feature.layer && feature.layer.id === 'nhd-streams') return 'stream';
    if (feature.layer && feature.layer.id === 'nhd-waterbodies-fill') return 'waterbody';
    if (feature.layer && feature.layer.id === 'nhd-areas-fill') return 'area';
    const gt = feature.geometry?.type;
    if (gt === 'LineString' || gt === 'MultiLineString') return 'stream';
    return 'waterbody';
}

function streamPopupHtml(feature) {
    const p = feature.properties || {};
    const name = p.gnis_name || null;
    const rows = [];

    if (p.max_strahler !== undefined && p.max_strahler !== null) {
        rows.push(['Stream order', p.max_strahler]);
    }
    const lenKm = fmtNumber(p.total_length_km, 1);
    if (lenKm !== null) {
        const lenMi = (Number(lenKm) * 0.621371).toFixed(1);
        rows.push(['Length', `${lenKm} km (${lenMi} mi)`]);
    }
    const drain = fmtNumber(p.max_drainage_area_sqkm, 0);
    if (drain !== null) rows.push(['Drainage area', `${drain} km²`]);
    const flow = fmtNumber(p.avg_flow_cfs, 1);
    if (flow !== null) rows.push(['Avg flow', `${flow} cfs`]);
    const slope = fmtNumber(p.avg_slope, 4);
    if (slope !== null) rows.push(['Avg gradient', `${(Number(slope) * 100).toFixed(2)}%`]);
    if (p.segment_count !== undefined && p.segment_count !== null) {
        rows.push(['NHD segments', p.segment_count]);
    }
    if (p.gnis_id) rows.push(['GNIS ID', p.gnis_id]);

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

function openHydroPopup(feature, lngLat) {
    if (state.openPopup) {
        state.openPopup.remove();
        state.openPopup = null;
    }
    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '320px'
    })
        .setLngLat(lngLat)
        .setHTML(hydroPopupHtml(feature))
        .addTo(state.map);

    popup.on('close', () => {
        clearSelectedHydro();
        if (state.openPopup === popup) state.openPopup = null;
    });

    state.openPopup = popup;
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
            // Hover uses findAllFragments too so the entire river/lake glows
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

    // Compass: click resets bearing to north; icon rotates as map rotates
    const compassBtn = document.getElementById('fabCompass');
    const compassIcon = compassBtn.querySelector('i');
    compassBtn.addEventListener('click', () => {
        state.map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    });
    state.map.on('rotate', () => {
        // The compass icon points "up" (north). When the map's bearing rotates,
        // we counter-rotate the icon so it keeps pointing to actual north.
        compassIcon.style.transform = `rotate(${-state.map.getBearing()}deg)`;
    });
}

// --- Query mode -----------------------------------------------------------
//
// Click anywhere on the map (with query mode active) and get every rendered
// feature at that point, grouped by style-layer id. Each group is a
// collapsible <details> block — click the layer header to expand and see the
// source-layer + properties for each feature in that group. Useful for
// styling work: click a trail, see exactly which OMT source-layer and
// class/subclass it has, then go write the filter in the style JSON.

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

        // Unfiltered: every rendered feature at this point, across every layer
        const features = state.map.queryRenderedFeatures(e.point);

        const resultEl = document.getElementById('queryResult');
        const bodyEl = document.getElementById('queryResultBody');

        if (features.length === 0) {
            bodyEl.innerHTML = '<em class="text-muted">No features at this location.</em>';
        } else {
            // Group by style-layer id, preserving first-seen order
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

export function setMode(mode, onSavedActivate) {
    if (mode === 'layers') return;
    document.querySelectorAll('.app-tab, .dock-tab').forEach(t => {
        if (t.dataset.mode === 'layers') return;
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    const savedPanel = document.getElementById('savedPanel');
    if (mode === 'saved') {
        savedPanel.classList.remove('d-none');
        if (onSavedActivate) onSavedActivate();
    } else {
        savedPanel.classList.add('d-none');
    }
}

export function initModeTabs(onSavedActivate) {
    window.setMode = (mode) => setMode(mode, onSavedActivate);
    document.querySelectorAll('.app-tab, .dock-tab').forEach(tab => {
        tab.addEventListener('click', () => setMode(tab.dataset.mode, onSavedActivate));
    });
}