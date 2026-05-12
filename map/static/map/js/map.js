// ============================================================================
// MF Maps — Map application
// ============================================================================

// --- Configuration ---------------------------------------------------------

const H3_RES = 8; // ~750 m hex cells

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
    layers: [
        { id: 'osm-base', type: 'raster', source: 'osm-raster' }
    ]
};

// --- Map initialization ----------------------------------------------------

const map = new maplibregl.Map({
    container: 'map',
    style: OSM_STYLE,
    bounds: US_BOUNDS,
    fitBoundsOptions: { padding: 40 }
});

// We hide MapLibre's default control containers via CSS and roll our own,
// but we still need the GeolocateControl instance for its events + behavior.
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserLocation: true
});
map.addControl(geolocate, 'top-right'); // container hidden by CSS

map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

// --- Layer groups ----------------------------------------------------------

const LAYER_IDS = {
    'random-points': ['random-points-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line']
};

// --- Sources & layers (after style load) ----------------------------------

map.on('load', () => {
    map.addSource('random-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'random-points-layer',
        type: 'circle',
        source: 'random-points',
        paint: {
            'circle-radius': 5,
            'circle-color': '#d96d2a',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5
        },
        layout: { visibility: 'none' }
    });

    map.addSource('h3-hexes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'h3-hexes-fill',
        type: 'fill',
        source: 'h3-hexes',
        paint: {
            'fill-color': [
                'interpolate', ['linear'], ['get', 'count'],
                1, '#fee5d9',
                3, '#fcae91',
                5, '#fb6a4a',
                8, '#cb181d'
            ],
            'fill-opacity': 0.6
        },
        layout: { visibility: 'none' }
    }, 'random-points-layer');

    map.addLayer({
        id: 'h3-hexes-line',
        type: 'line',
        source: 'h3-hexes',
        paint: { 'line-color': '#2c5530', 'line-width': 1 },
        layout: { visibility: 'none' }
    }, 'random-points-layer');

    map.addSource('user-h3', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

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

    initLayerPanels();
    wireFabs();
    wireQueryMode();
    wireGeolocate();
    wireDockTabs();
});

// --- Shared layer panel: render template into desktop + mobile containers --

function initLayerPanels() {
    const template = document.getElementById('layerPanelTemplate');

    // Desktop sidebar
    renderPanelInto(template, document.querySelector('.side-panel-body'), 'desk');
    // Mobile bottom sheet
    renderPanelInto(template, document.getElementById('layersSheetBody'), 'mob');

    // Wire all rendered toggles + buttons across both panels
    document.querySelectorAll('.layer-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.dataset.layerGroup;
            const visible = e.target.checked;
            setLayerGroupVisibility(group, visible);
            // Keep the other panel's matching toggle in sync
            document.querySelectorAll(`.layer-toggle[data-layer-group="${group}"]`)
                .forEach(cb => { if (cb !== e.target) cb.checked = visible; });
        });
    });

    document.querySelectorAll('.js-clear-demo').forEach(btn => {
        btn.addEventListener('click', clearDemo);
    });
}

function renderPanelInto(template, container, contextSuffix) {
    if (!container) return;
    const clone = template.content.cloneNode(true);
    // Make checkbox IDs unique across the two clones so labels still pair properly
    clone.querySelectorAll('[id$="-CTX"]').forEach(el => {
        const newId = el.id.replace(/-CTX$/, `-${contextSuffix}`);
        el.id = newId;
    });
    clone.querySelectorAll('label[for$="-CTX"]').forEach(label => {
        label.htmlFor = label.htmlFor.replace(/-CTX$/, `-${contextSuffix}`);
    });
    container.appendChild(clone);
}

function setLayerGroupVisibility(group, visible) {
    (LAYER_IDS[group] || []).forEach(id => {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

function setLayerToggleUI(group, checked) {
    document.querySelectorAll(`.layer-toggle[data-layer-group="${group}"]`)
        .forEach(cb => { cb.checked = checked; });
}

// --- FAB buttons ----------------------------------------------------------

function wireFabs() {
    document.getElementById('fabGeolocate').addEventListener('click', () => {
        geolocate.trigger();
    });

    document.getElementById('fabPrimary').addEventListener('click', () => {
        addRandomPoints();
    });

    // Query toggle handled in wireQueryMode
}

// --- Demo: random points + H3 aggregation ---------------------------------

function generateRandomPoints(n = 50) {
    const bounds = map.getBounds();
    const features = [];
    for (let i = 0; i < n; i++) {
        const lng = bounds.getWest() + Math.random() * (bounds.getEast() - bounds.getWest());
        const lat = bounds.getSouth() + Math.random() * (bounds.getNorth() - bounds.getSouth());
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { id: i }
        });
    }
    return { type: 'FeatureCollection', features };
}

function aggregateToH3(pointCollection, resolution = H3_RES) {
    const cellCounts = new Map();
    pointCollection.features.forEach(feat => {
        const [lng, lat] = feat.geometry.coordinates;
        const cell = h3.latLngToCell(lat, lng, resolution);
        cellCounts.set(cell, (cellCounts.get(cell) || 0) + 1);
    });

    const features = [];
    cellCounts.forEach((count, cell) => {
        const boundary = h3.cellToBoundary(cell, false).map(([lat, lng]) => [lng, lat]);
        boundary.push(boundary[0]);
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [boundary] },
            properties: { h3: cell, count }
        });
    });

    return { type: 'FeatureCollection', features };
}

function addRandomPoints() {
    const points = generateRandomPoints(50);
    const hexes = aggregateToH3(points, H3_RES);

    map.getSource('random-points').setData(points);
    map.getSource('h3-hexes').setData(hexes);

    ['random-points', 'h3-hexes'].forEach(group => {
        setLayerGroupVisibility(group, true);
        setLayerToggleUI(group, true);
    });
}

function clearDemo() {
    const empty = { type: 'FeatureCollection', features: [] };
    map.getSource('random-points').setData(empty);
    map.getSource('h3-hexes').setData(empty);
    ['random-points', 'h3-hexes'].forEach(group => {
        setLayerGroupVisibility(group, false);
        setLayerToggleUI(group, false);
    });
}

// --- Query mode -----------------------------------------------------------

let queryMode = false;

function wireQueryMode() {
    const btn = document.getElementById('fabQuery');
    btn.addEventListener('click', () => {
        queryMode = !queryMode;
        btn.setAttribute('aria-pressed', queryMode ? 'true' : 'false');
        document.body.classList.toggle('query-mode', queryMode);
        if (!queryMode) {
            document.getElementById('queryResult').classList.add('d-none');
        }
    });

    map.on('click', (e) => {
        if (!queryMode) return;
        const queryableLayers = ['random-points-layer', 'h3-hexes-fill']
            .filter(id => map.getLayer(id));
        const features = map.queryRenderedFeatures(e.point, { layers: queryableLayers });

        const resultEl = document.getElementById('queryResult');
        const bodyEl = document.getElementById('queryResultBody');

        if (features.length === 0) {
            bodyEl.innerHTML = '<em class="text-muted">No features at this location.</em>';
        } else {
            bodyEl.innerHTML = features.map(f => {
                const props = JSON.stringify(f.properties, null, 2);
                return `<div class="mb-2"><strong>${f.layer.id}</strong>` +
                       `<pre class="small mb-0">${props}</pre></div>`;
            }).join('');
        }
        resultEl.classList.remove('d-none');
    });
}

// --- Geolocation + user's H3 cell -----------------------------------------

function wireGeolocate() {
    geolocate.on('geolocate', (position) => {
        const { latitude, longitude } = position.coords;
        const cell = h3.latLngToCell(latitude, longitude, H3_RES);
        const boundary = h3.cellToBoundary(cell, false).map(([lat, lng]) => [lng, lat]);
        boundary.push(boundary[0]);

        map.getSource('user-h3').setData({
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
        document.querySelectorAll('.user-location-info').forEach(el => {
            el.innerHTML = html;
        });
    });

    geolocate.on('error', () => {
        document.querySelectorAll('.user-location-info').forEach(el => {
            el.innerHTML = '<em class="text-warning-emphasis">Could not get your location.</em>';
        });
    });
}

// --- Mode tabs (Map / List), both desktop and mobile dock -----------------

function setMode(mode) {
    document.querySelectorAll('.app-tab, .dock-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    const listPanel = document.getElementById('listPanel');
    if (mode === 'list') {
        listPanel.classList.remove('d-none');
    } else {
        listPanel.classList.add('d-none');
    }
}
// expose so the inline close-button in listPanel can call it
window.setMode = setMode;

function wireDockTabs() {
    document.querySelectorAll('.app-tab, .dock-tab').forEach(tab => {
        tab.addEventListener('click', () => setMode(tab.dataset.mode));
    });
}