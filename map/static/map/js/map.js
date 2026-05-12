// ============================================================================
// MF Maps — Map application
// ============================================================================

// --- Configuration ---------------------------------------------------------

const H3_RES = 8; // ~750 m hex cells

// Continental US bounds for initial view
const US_BOUNDS = [
    [-125.0, 24.5],  // SW
    [-66.5, 49.5]    // NE
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
        {
            id: 'osm-base',
            type: 'raster',
            source: 'osm-raster'
        }
    ]
};

// --- Map initialization ----------------------------------------------------

const map = new maplibregl.Map({
    container: 'map',
    style: OSM_STYLE,
    bounds: US_BOUNDS,
    fitBoundsOptions: { padding: 40 }
});

// MapLibre built-in controls
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');

const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserLocation: true
});
map.addControl(geolocate, 'bottom-right');

map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

// --- Sources & layers (added once map style is loaded) ---------------------

const LAYER_IDS = {
    'random-points': ['random-points-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line']
};

map.on('load', () => {
    // Random points source + layer
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

    // H3 hexes source + layers (fill + outline)
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
    }, 'random-points-layer'); // ensure hexes render below points

    map.addLayer({
        id: 'h3-hexes-line',
        type: 'line',
        source: 'h3-hexes',
        paint: {
            'line-color': '#2c5530',
            'line-width': 1
        },
        layout: { visibility: 'none' }
    }, 'random-points-layer');

    // User location H3 cell
    map.addSource('user-h3', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'user-h3-fill',
        type: 'fill',
        source: 'user-h3',
        paint: {
            'fill-color': '#2c5530',
            'fill-opacity': 0.2
        }
    });

    map.addLayer({
        id: 'user-h3-line',
        type: 'line',
        source: 'user-h3',
        paint: {
            'line-color': '#2c5530',
            'line-width': 2
        }
    });

    wireLayerToggles();
    wireDemoButtons();
    wireQueryMode();
    wireGeolocation();
});

// --- Layer visibility toggles ---------------------------------------------

function setLayerGroupVisibility(group, visible) {
    const layerIds = LAYER_IDS[group] || [];
    layerIds.forEach(id => {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
}

function wireLayerToggles() {
    document.querySelectorAll('.layer-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.dataset.layerGroup;
            setLayerGroupVisibility(group, e.target.checked);
        });
    });
}

// --- Demo: 50 random points + H3 aggregation -------------------------------

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
        // h3.cellToBoundary returns [lat, lng] pairs; GeoJSON wants [lng, lat]
        const boundary = h3.cellToBoundary(cell, false).map(([lat, lng]) => [lng, lat]);
        // Close the polygon
        boundary.push(boundary[0]);
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [boundary] },
            properties: { h3: cell, count }
        });
    });

    return { type: 'FeatureCollection', features };
}

function wireDemoButtons() {
    document.getElementById('addRandomPoints').addEventListener('click', () => {
        const points = generateRandomPoints(50);
        const hexes = aggregateToH3(points, H3_RES);

        map.getSource('random-points').setData(points);
        map.getSource('h3-hexes').setData(hexes);

        // Auto-enable the layers and check the toggle UI
        ['random-points', 'h3-hexes'].forEach(group => {
            setLayerGroupVisibility(group, true);
            const checkbox = document.querySelector(`[data-layer-group="${group}"]`);
            if (checkbox) checkbox.checked = true;
        });
    });

    document.getElementById('clearDemo').addEventListener('click', () => {
        const empty = { type: 'FeatureCollection', features: [] };
        map.getSource('random-points').setData(empty);
        map.getSource('h3-hexes').setData(empty);
        ['random-points', 'h3-hexes'].forEach(group => {
            setLayerGroupVisibility(group, false);
            const checkbox = document.querySelector(`[data-layer-group="${group}"]`);
            if (checkbox) checkbox.checked = false;
        });
    });
}

// --- Query mode -----------------------------------------------------------

let queryMode = false;

function wireQueryMode() {
    const btn = document.getElementById('queryToggle');
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

        const queryableLayers = [
            'random-points-layer',
            'h3-hexes-fill'
        ].filter(id => map.getLayer(id));

        const features = map.queryRenderedFeatures(e.point, { layers: queryableLayers });

        const resultEl = document.getElementById('queryResult');
        const bodyEl = document.getElementById('queryResultBody');

        if (features.length === 0) {
            bodyEl.innerHTML = '<em class="text-muted">No features at this location.</em>';
        } else {
            const lines = features.map(f => {
                const layer = f.layer.id;
                const props = JSON.stringify(f.properties, null, 2);
                return `<div class="mb-2"><strong>${layer}</strong><pre class="small mb-0">${props}</pre></div>`;
            });
            bodyEl.innerHTML = lines.join('');
        }

        resultEl.classList.remove('d-none');
    });
}

// --- Geolocation + user's H3 cell -----------------------------------------

function wireGeolocation() {
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

        document.getElementById('userLocationInfo').innerHTML = `
            <div class="mb-1"><strong>Lat:</strong> ${latitude.toFixed(5)}</div>
            <div class="mb-1"><strong>Lng:</strong> ${longitude.toFixed(5)}</div>
            <div class="mb-1"><strong>H3 cell (res ${H3_RES}):</strong> <code class="small">${cell}</code></div>
        `;
    });

    geolocate.on('error', () => {
        document.getElementById('userLocationInfo').innerHTML =
            '<em class="text-warning-emphasis">Could not get your location. Check browser permissions.</em>';
    });
}