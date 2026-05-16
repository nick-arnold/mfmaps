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
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

// Shared color palette for hydrography
const STREAM_COLOR = '#2e6f96';   // primary blue stroke for streams, water outlines, labels
const WATER_FILL   = '#9ecbe0';   // slightly lighter shade for polygon fills
const LABEL_HALO   = '#ffffff';   // halo for readability over varied basemap

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

    // ------------------------------------------------------------------
    // NHD hydrography (Oregon, merged by GNIS_ID)
    //
    // Source-layers in the PMTiles:
    //   - streams      (LineString/MultiLineString, one feature per named river)
    //   - waterbodies  (Polygon, lakes/reservoirs/ponds)
    //   - areas        (Polygon, wide rivers like the Columbia)
    //
    // Render order, bottom to top:
    //   1. nhd-hover-halo         soft glow under hovered stream
    //   2. nhd-streams            merged river lines
    //   3. nhd-areas-fill         wide-river polygons (covers ArtificialPath centerlines)
    //   4. nhd-areas-stroke
    //   5. nhd-waterbodies-fill   lakes (covers their own centerlines too)
    //   6. nhd-waterbodies-stroke
    //   7. nhd-selected           orange highlight (above everything water-related)
    //   8. nhd-streams-label      line-following river labels
    //   9. nhd-waterbodies-label  point-placed lake labels
    // ------------------------------------------------------------------
    map.addSource('nhd', {
        type: 'vector',
        url: 'pmtiles://https://protomaps-example.s3.us-west-2.amazonaws.com/oregon_hydro.pmtiles'
    });

    map.addSource('nhd-hover',    { type: 'geojson', data: empty });
    map.addSource('nhd-selected', { type: 'geojson', data: empty });

    // Stream width — scaled continuously by Strahler order at the river's mouth.
    // Tuned ~30% thinner than the previous build.
    const widthByStrahler = [
        'interpolate', ['linear'], ['zoom'],
        4,  ['*', 0.15, ['to-number', ['get', 'max_strahler']]],
        8,  ['*', 0.28, ['to-number', ['get', 'max_strahler']]],
        12, ['*', 0.52, ['to-number', ['get', 'max_strahler']]],
        16, ['*', 0.90, ['to-number', ['get', 'max_strahler']]],
        19, ['*', 1.40, ['to-number', ['get', 'max_strahler']]]
    ];

    // --- 1. Hover halo (soft glow UNDER everything else) --------------
    map.addLayer({
        id: 'nhd-hover-halo',
        type: 'line',
        source: 'nhd-hover',
        paint: {
            'line-color': '#ffd24a',
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4, 4, 10, 8, 14, 14, 17, 22
            ],
            'line-opacity': 0.55,
            'line-blur': 4
        }
    });

    // --- 2. Streams (merged-by-gnis_id river lines) -------------------
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
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        }
    });

    // --- 3. Areas fill (wide rivers as polygons; covers ArtificialPath) -
    map.addLayer({
        id: 'nhd-areas-fill',
        type: 'fill',
        source: 'nhd',
        'source-layer': 'areas',
        paint: {
            'fill-color': WATER_FILL,
            'fill-opacity': 0.95
        }
    });

    // --- 4. Areas stroke ---------------------------------------------
    map.addLayer({
        id: 'nhd-areas-stroke',
        type: 'line',
        source: 'nhd',
        'source-layer': 'areas',
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': 0.8,
            'line-opacity': 0.85
        }
    });

    // --- 5. Waterbodies fill (lakes/reservoirs/ponds) -----------------
    map.addLayer({
        id: 'nhd-waterbodies-fill',
        type: 'fill',
        source: 'nhd',
        'source-layer': 'waterbodies',
        paint: {
            'fill-color': WATER_FILL,
            'fill-opacity': 0.95
        }
    });

    // --- 6. Waterbodies stroke ---------------------------------------
    map.addLayer({
        id: 'nhd-waterbodies-stroke',
        type: 'line',
        source: 'nhd',
        'source-layer': 'waterbodies',
        paint: {
            'line-color': STREAM_COLOR,
            'line-width': 0.8,
            'line-opacity': 0.9
        }
    });

    // --- 7. Selected highlight (above water layers, below labels) ----
    map.addLayer({
        id: 'nhd-selected',
        type: 'line',
        source: 'nhd-selected',
        paint: {
            'line-color': '#ff7a1a',
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4,  ['max', 2, ['*', 0.30, ['to-number', ['get', 'max_strahler']]]],
                10, ['max', 3, ['*', 0.60, ['to-number', ['get', 'max_strahler']]]],
                14, ['max', 4, ['*', 1.10, ['to-number', ['get', 'max_strahler']]]],
                17, ['max', 5, ['*', 1.80, ['to-number', ['get', 'max_strahler']]]]
            ],
            'line-opacity': 1.0
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        }
    });

    // --- 8. Stream labels (curve along the line) ----------------------
    // Zoom-tiered: only the biggest rivers at low zooms, all named at high zoom.
    map.addLayer({
        id: 'nhd-streams-label',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'streams',
        minzoom: 7,
        filter: [
            'any',
            ['all', ['<=', ['zoom'], 8],  ['>=', ['to-number', ['get', 'max_strahler']], 6]],
            ['all', ['<=', ['zoom'], 10], ['>=', ['to-number', ['get', 'max_strahler']], 5]],
            ['all', ['<=', ['zoom'], 12], ['>=', ['to-number', ['get', 'max_strahler']], 4]],
            ['all', ['<=', ['zoom'], 14], ['>=', ['to-number', ['get', 'max_strahler']], 3]],
            ['>', ['zoom'], 14]
        ],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': ['Open Sans SemiBold'],
            'symbol-placement': 'line',
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                7, 10,
                12, 12,
                16, 14
            ],
            'text-letter-spacing': 0.05,
            'symbol-spacing': 350,
            'text-max-angle': 30,
            'text-pitch-alignment': 'viewport'
        },
        paint: {
            'text-color': STREAM_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 1.5,
            'text-halo-blur': 0.5
        }
    });

    // --- 9. Waterbody labels (one per lake) ---------------------------
    map.addLayer({
        id: 'nhd-waterbodies-label',
        type: 'symbol',
        source: 'nhd',
        'source-layer': 'waterbodies',
        minzoom: 6,
        filter: [
            'all',
            ['has', 'gnis_name'],
            [
                'any',
                ['all', ['<=', ['zoom'], 7],  ['>=', ['to-number', ['get', 'areasqkm']], 50]],
                ['all', ['<=', ['zoom'], 9],  ['>=', ['to-number', ['get', 'areasqkm']], 5]],
                ['all', ['<=', ['zoom'], 11], ['>=', ['to-number', ['get', 'areasqkm']], 0.5]],
                ['>', ['zoom'], 11]
            ]
        ],
        layout: {
            'text-field': ['get', 'gnis_name'],
            'text-font': ['Open Sans SemiBold'],
            'text-size': [
                'interpolate', ['linear'], ['zoom'],
                6, 11,
                10, 13,
                14, 15
            ],
            'text-max-width': 8,
            'text-letter-spacing': 0.02
        },
        paint: {
            'text-color': STREAM_COLOR,
            'text-halo-color': LABEL_HALO,
            'text-halo-width': 1.8,
            'text-halo-blur': 0.5
        }
    });

    // ------------------------------------------------------------------
    // H3 hexes (computed from observations, layered BELOW the pins)
    // ------------------------------------------------------------------
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

    // Observations (user pins, on top of all hydrography)
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

// --- Hydrography interactions: hover halo + click select + popup ----------

const HYDRO_INTERACTIVE_LAYERS = ['nhd-streams'];
const HYDRO_CLICK_BUFFER_PX = 5;

function queryNearbyHydroFeature(point) {
    const map = state.map;
    const b = HYDRO_CLICK_BUFFER_PX;
    const bbox = [
        [point.x - b, point.y - b],
        [point.x + b, point.y + b]
    ];
    const layers = HYDRO_INTERACTIVE_LAYERS.filter(id => map.getLayer(id));
    if (!layers.length) return null;
    const feats = map.queryRenderedFeatures(bbox, { layers });
    if (!feats.length) return null;
    feats.sort((a, b) => {
        const oa = Number(a.properties.max_strahler) || 0;
        const ob = Number(b.properties.max_strahler) || 0;
        return ob - oa;
    });
    return feats[0];
}

function setHoveredHydro(feature) {
    const src = state.map.getSource('nhd-hover');
    if (!src) return;
    src.setData(feature
        ? { type: 'FeatureCollection', features: [feature] }
        : { type: 'FeatureCollection', features: [] }
    );
}

function setSelectedHydro(feature) {
    const src = state.map.getSource('nhd-selected');
    if (!src) return;
    src.setData(feature
        ? { type: 'FeatureCollection', features: [feature] }
        : { type: 'FeatureCollection', features: [] }
    );
}

function clearSelectedHydro() {
    setSelectedHydro(null);
}

function fmtNumber(v, digits) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n.toFixed(digits);
}

function hydroPopupHtml(feature) {
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
    if (drain !== null) {
        rows.push(['Drainage area', `${drain} km²`]);
    }
    const flow = fmtNumber(p.avg_flow_cfs, 1);
    if (flow !== null) {
        rows.push(['Avg flow', `${flow} cfs`]);
    }
    const slope = fmtNumber(p.avg_slope, 4);
    if (slope !== null) {
        const pct = (Number(slope) * 100).toFixed(2);
        rows.push(['Avg gradient', `${pct}%`]);
    }
    if (p.segment_count !== undefined && p.segment_count !== null) {
        rows.push(['NHD segments', p.segment_count]);
    }
    if (p.gnis_id) {
        rows.push(['GNIS ID', p.gnis_id]);
    }

    const title = name
        ? `<div class="fw-bold mb-2">${escapeHtml(String(name))}</div>`
        : `<div class="fw-bold mb-2 text-muted">Unnamed waterway</div>`;

    const body = rows.map(([k, v]) =>
        `<div class="small d-flex justify-content-between gap-3">` +
        `<span class="text-muted">${escapeHtml(String(k))}</span>` +
        `<span><code>${escapeHtml(String(v))}</code></span>` +
        `</div>`
    ).join('');

    return `<div class="hydro-popup" style="min-width: 220px;">${title}${body}</div>`;
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
                    JSON.stringify(feat.geometry?.coordinates?.[0] || []);
        if (key !== lastHoveredKey) {
            setHoveredHydro(feat);
            lastHoveredKey = key;
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('click', (e) => {
        if (state.queryMode) return;
        if (map.getLayer('observations-layer')) {
            const obsHit = map.queryRenderedFeatures(e.point, {
                layers: ['observations-layer']
            });
            if (obsHit.length) return;
        }

        const feat = queryNearbyHydroFeature(e.point);
        if (!feat) {
            clearSelectedHydro();
            return;
        }
        setSelectedHydro(feat);
        openHydroPopup(feat, e.lngLat);
    });
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
            'observations-layer',
            'h3-hexes-fill',
            'nhd-streams',
            'nhd-waterbodies-fill',
            'nhd-areas-fill'
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