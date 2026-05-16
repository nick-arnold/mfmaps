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

// --- Map init -------------------------------------------------------------

export function initMap() {
    // Register the pmtiles:// protocol with MapLibre so we can read PMTiles
    // archives directly from object storage. Safe to call once at startup.
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
    // NHD hydrography (PMTiles, all-US, with Strahler stream order)
    //
    // Source-layer:  NHD_AllUS_wOrder
    // Strahler key:  StreamOrde   (NHD shapefile-era truncated name)
    //
    // Five layers:
    //   1. nhd-hover-halo    — soft glow under the hovered stream
    //   2. nhd-streams-small — Strahler 1-3
    //   3. nhd-streams-medium— Strahler 4-5
    //   4. nhd-rivers-large  — Strahler 6+
    //   5. nhd-selected      — bright recolor over the clicked stream
    // ------------------------------------------------------------------
    map.addSource('nhd', {
        type: 'vector',
        url: 'pmtiles://https://protomaps-example.s3.us-west-2.amazonaws.com/NHD_AllUS_wOrder'
    });

    // Separate GeoJSON sources for hover/select state, since the PMTiles
    // features lack stable IDs we can use with setFeatureState.
    map.addSource('nhd-hover', { type: 'geojson', data: empty });
    map.addSource('nhd-selected', { type: 'geojson', data: empty });

    const NHD_SRC_LAYER = 'NHD_AllUS_wOrder';
    const STRAHLER = 'StreamOrde';

    // Width expression: scales continuously with both Strahler order and zoom.
    const widthByStrahler = [
        'interpolate', ['linear'], ['zoom'],
        4,  ['*', 0.18, ['to-number', ['get', STRAHLER]]],
        8,  ['*', 0.35, ['to-number', ['get', STRAHLER]]],
        12, ['*', 0.65, ['to-number', ['get', STRAHLER]]],
        16, ['*', 1.10, ['to-number', ['get', STRAHLER]]],
        19, ['*', 1.80, ['to-number', ['get', STRAHLER]]]
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
                4, 4,
                10, 8,
                14, 14,
                17, 22
            ],
            'line-opacity': 0.55,
            'line-blur': 4
        }
    });

    // --- 2. Small streams (Strahler 1-3) ------------------------------
    map.addLayer({
        id: 'nhd-streams-small',
        type: 'line',
        source: 'nhd',
        'source-layer': NHD_SRC_LAYER,
        minzoom: 9,
        filter: ['<=', ['to-number', ['get', STRAHLER]], 3],
        paint: {
            'line-color': '#7eaecf',
            'line-width': widthByStrahler,
            'line-opacity': 0.9
        }
    });

    // --- 3. Medium streams (Strahler 4-5) -----------------------------
    map.addLayer({
        id: 'nhd-streams-medium',
        type: 'line',
        source: 'nhd',
        'source-layer': NHD_SRC_LAYER,
        minzoom: 6,
        filter: [
            'all',
            ['>=', ['to-number', ['get', STRAHLER]], 4],
            ['<=', ['to-number', ['get', STRAHLER]], 5]
        ],
        paint: {
            'line-color': '#4f8db5',
            'line-width': widthByStrahler,
            'line-opacity': 0.95
        }
    });

    // --- 4. Large rivers (Strahler 6+) --------------------------------
    map.addLayer({
        id: 'nhd-rivers-large',
        type: 'line',
        source: 'nhd',
        'source-layer': NHD_SRC_LAYER,
        minzoom: 3,
        filter: ['>=', ['to-number', ['get', STRAHLER]], 6],
        paint: {
            'line-color': '#2e6f96',
            'line-width': widthByStrahler,
            'line-opacity': 1.0
        }
    });

    // --- 5. Selected highlight (bright recolor OVER the streams) ------
    map.addLayer({
        id: 'nhd-selected',
        type: 'line',
        source: 'nhd-selected',
        paint: {
            'line-color': '#ff7a1a',
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                4,  ['max', 2, ['*', 0.35, ['to-number', ['get', STRAHLER]]]],
                10, ['max', 3, ['*', 0.7,  ['to-number', ['get', STRAHLER]]]],
                14, ['max', 4, ['*', 1.3,  ['to-number', ['get', STRAHLER]]]],
                17, ['max', 5, ['*', 2.0,  ['to-number', ['get', STRAHLER]]]]
            ],
            'line-opacity': 1.0
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

// --- Hydrography interactions: hover halo + click select + popup ----------

const HYDRO_INTERACTIVE_LAYERS = [
    'nhd-streams-small',
    'nhd-streams-medium',
    'nhd-rivers-large'
];

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
    // Prefer larger streams when multiple overlap a single click
    feats.sort((a, b) => {
        const oa = Number(a.properties.StreamOrde) || 0;
        const ob = Number(b.properties.StreamOrde) || 0;
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

function hydroPopupHtml(feature) {
    const p = feature.properties || {};
    const name = p.GNIS_Name || p.gnis_name || p.NAME || null;

    const knownRows = [
        ['Type',           p.FTYPE],
        ['Stream order',   p.StreamOrde],
        ['Stream level',   p.StreamLeve],
        ['Stream calc',    p.StreamCalc],
        ['Flow direction', p.FLOWDIR]
    ].filter(([, v]) => v !== undefined && v !== null && v !== '');

    // Surface any unexpected attributes too, so we don't silently swallow data
    const known = new Set(['GNIS_Name', 'gnis_name', 'NAME',
                           'FTYPE', 'StreamOrde', 'StreamLeve',
                           'StreamCalc', 'FLOWDIR']);
    const extraRows = Object.entries(p)
        .filter(([k, v]) => !known.has(k) && v !== undefined && v !== null && v !== '');

    const title = name
        ? `<div class="fw-bold mb-2">${escapeHtml(String(name))}</div>`
        : `<div class="fw-bold mb-2 text-muted">Unnamed waterway</div>`;

    const body = [...knownRows, ...extraRows].map(([k, v]) =>
        `<div class="small d-flex justify-content-between gap-3">` +
        `<span class="text-muted">${escapeHtml(String(k))}</span>` +
        `<span><code>${escapeHtml(String(v))}</code></span>` +
        `</div>`
    ).join('');

    return `<div class="hydro-popup" style="min-width: 200px;">${title}${body}</div>`;
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
        if (state.queryMode) return; // don't interfere with query mode
        const feat = queryNearbyHydroFeature(e.point);
        if (!feat) {
            if (lastHoveredKey !== null) {
                setHoveredHydro(null);
                lastHoveredKey = null;
                map.getCanvas().style.cursor = '';
            }
            return;
        }
        // Cheap dedupe so we're not resetting GeoJSON on every pixel of motion
        const coords = feat.geometry.coordinates;
        const firstPt = Array.isArray(coords[0]) ? coords[0] : coords;
        const key = JSON.stringify(firstPt) + '|' + (feat.properties.StreamOrde ?? '');
        if (key !== lastHoveredKey) {
            setHoveredHydro(feat);
            lastHoveredKey = key;
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('click', (e) => {
        if (state.queryMode) return; // query-mode handler takes over
        // Don't hijack clicks on observation pins
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
        const queryable = ['observations-layer', 'h3-hexes-fill',
                           'nhd-streams-small', 'nhd-streams-medium', 'nhd-rivers-large']
            .filter(id => state.map.getLayer(id));
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

// Map zoom level → H3 resolution
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