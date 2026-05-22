// =============================================================================
// Map initialization, sources/layers, geolocation, query mode, mode tabs
// =============================================================================

import { state, LAYER_IDS, H3_RES } from './state.js';
import { escapeHtml } from './api.js';

const US_BOUNDS = [
    [-125.0, 24.5],
    [-66.5, 49.5]
];

const OSM_STYLE = {
    version: 8,
    glyphs: 'https://tiles.openstreetmap.us/fonts/{fontstack}/{range}.pbf',
    sources: {
        'osm-raster': {
            type: 'raster',
            tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
        }
    },
    layers: [{ id: 'osm-base', type: 'raster', source: 'osm-raster' }]
};

// Shared color palette
const STREAM_COLOR   = '#2e6f96';
const WATER_FILL     = '#9ecbe0';
const LABEL_HALO     = '#ffffff';
const LABEL_FONT     = ['Noto Sans Italic'];
const HOVER_COLOR    = '#ffb300';
const SELECTED_COLOR = '#ff7a1a';

// --- Map init -------------------------------------------------------------

export function initMap() {
    if (!state._pmtilesRegistered) {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        state._pmtilesRegistered = true;
    }

    state.map = new maplibregl.Map({
        container: 'map',
        style: OSM_STYLE,
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: 40 }
    });

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
            resolve();
        });
    });
}

// --- Sources and layers ---------------------------------------------------

function addSourcesAndLayers() {
    const { map } = state;
    const empty = { type: 'FeatureCollection', features: [] };

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
        });
    });

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

    // --- Contours (Hawaii proof tier, z11+) ---------------------------
    map.addSource('contours', {
        type: 'vector',
        url: 'pmtiles://https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/contours/hawaii_contour_z11.pmtiles'
    });

    // Intermediate lines (thin) — idx = 0
    map.addLayer({
        id: 'contour-intermediate',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['==', ['get', 'idx'], 0],
        minzoom: 11,
        paint: {
            'line-color': '#9a7b4f',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.8],
            'line-opacity': 0.5
        }
    });

    // Index lines (thick) — idx = 1
    map.addLayer({
        id: 'contour-index',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['==', ['get', 'idx'], 1],
        minzoom: 11,
        paint: {
            'line-color': '#7a5f3a',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 14, 1.6],
            'line-opacity': 0.7
        }
    });

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
        const queryable = [
            'observations-layer', 'h3-hexes-fill',
            'nhd-streams', 'nhd-waterbodies-fill'
        ].filter(id => state.map.getLayer(id));
        const features = state.map.queryRenderedFeatures(e.point, { layers: queryable });
        const resultEl = document.getElementById('queryResult');
        const bodyEl = document.getElementById('queryResultBody');
        if (features.length === 0) {
            bodyEl.innerHTML = '<em class="text-muted">No features at this location.</em>';
        } else {
            bodyEl.innerHTML = features.map(f => {
                const props = JSON.stringify(f.properties, null, 2);
                return `<div class="mb-2"><strong>${f.layer.id}</strong>` +
                       `<pre class="small mb-0">${escapeHtml(props)}</pre></div>`;
            }).join('');
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