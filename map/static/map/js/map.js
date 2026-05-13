// ============================================================================
// MF Maps — Map application
// ============================================================================

// --- Configuration ---------------------------------------------------------

const H3_RES = 8;

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

// --- Toast notifications --------------------------------------------------

function showToast(message, kind = 'info') {
    const toastEl = document.getElementById('appToast');
    const bodyEl = document.getElementById('appToastBody');
    toastEl.classList.remove('text-bg-dark', 'text-bg-success', 'text-bg-danger');
    if (kind === 'success') toastEl.classList.add('text-bg-success');
    else if (kind === 'error') toastEl.classList.add('text-bg-danger');
    else toastEl.classList.add('text-bg-dark');
    bodyEl.textContent = message;
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}


// --- Auth state ------------------------------------------------------------

let currentUser = null; // { email, id } when logged in, null otherwise
// Observation creation/editing state
let observationMode = null;       // 'create' | 'edit' | null
let editingObservationId = null;  // UUID when editing
let editMarker = null;            // draggable MapLibre Marker shown in edit mode
let pendingCoords = null;         // { latitude, longitude, accuracy }
// --- CSRF helper -----------------------------------------------------------

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
}

function csrfHeaders() {
    const token = getCookie('csrftoken');
    return token ? { 'X-CSRFToken': token, 'Content-Type': 'application/json' }
                 : { 'Content-Type': 'application/json' };
}

// --- API helpers -----------------------------------------------------------

async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
        credentials: 'same-origin',
        headers: csrfHeaders(),
        ...options,
    });
    return resp;
}


// Click on an observation pin → open popup
map.on('click', 'observations-layer', (e) => {
    if (queryMode) return; // query mode handles clicks differently
    if (!e.features?.length) return;
    const feature = e.features[0];
    showObservationPopup(feature);
});

// Cursor feedback over pins
map.on('mouseenter', 'observations-layer', () => {
    if (!queryMode) map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'observations-layer', () => {
    if (!queryMode) map.getCanvas().style.cursor = '';
});
// --- Auth flows ------------------------------------------------------------

async function fetchAuthState() {
    // allauth-headless: GET /_allauth/browser/v1/auth/session
    try {
        const resp = await apiFetch('/_allauth/browser/v1/auth/session');
        if (resp.ok) {
            const data = await resp.json();
            if (data.data?.user) {
                currentUser = {
                    email: data.data.user.email,
                    id: data.data.user.id,
                };
            } else {
                currentUser = null;
            }
        } else {
            currentUser = null;
        }
    } catch (e) {
        currentUser = null;
    }
    renderAccountMenus();
}

function renderAccountMenus() {
    const html = currentUser
        ? `
            <li class="dropdown-header small text-muted">Signed in as</li>
            <li class="dropdown-item-text small fw-bold text-truncate" style="max-width:240px">${currentUser.email}</li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="#" id="logoutLink"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
          `
        : `
            <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#loginModal"><i class="bi bi-box-arrow-in-right me-2"></i>Sign in</a></li>
            <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#signupModal"><i class="bi bi-person-plus me-2"></i>Create account</a></li>
          `;

    document.querySelectorAll('#accountMenu, #accountMenuMobile').forEach(el => {
        el.innerHTML = html;
    });

    document.querySelectorAll('#logoutLink').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            await logout();
        });
    });
}

async function login(email, password) {
    const resp = await apiFetch('/_allauth/browser/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (resp.ok) {
        await fetchAuthState();
        return { ok: true };
    }
    const msg = data?.errors?.[0]?.message || 'Sign in failed';
    return { ok: false, error: msg };
}

async function signup(email, password) {
    const resp = await apiFetch('/_allauth/browser/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (resp.ok) {
        await fetchAuthState();
        return { ok: true };
    }
    const msg = data?.errors?.[0]?.message || 'Sign up failed';
    return { ok: false, error: msg };
}

async function logout() {
    await apiFetch('/_allauth/browser/v1/auth/session', { method: 'DELETE' });
    await fetchAuthState();
    const empty = { type: 'FeatureCollection', features: [] };
    map.getSource('observations')?.setData(empty);
    showToast('Signed out', 'info');
}

function wireAuthForms() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = document.getElementById('loginError');
        errEl.classList.add('d-none');
        const result = await login(fd.get('email'), fd.get('password'));
        if (result.ok) {
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            e.target.reset();
            showToast(`Signed in as ${currentUser.email}`, 'success');
            loadObservations();
        } else {
            errEl.textContent = result.error;
            errEl.classList.remove('d-none');
        }
    });

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = document.getElementById('signupError');
        errEl.classList.add('d-none');
        const result = await signup(fd.get('email'), fd.get('password'));
        if (result.ok) {
            bootstrap.Modal.getInstance(document.getElementById('signupModal')).hide();
            e.target.reset();
            showToast(`Account created — welcome, ${currentUser.email}`, 'success');
            loadObservations();
        } else {
            errEl.textContent = result.error;
            errEl.classList.remove('d-none');
        }
    });

    document.getElementById('switchToSignup').addEventListener('click', (e) => {
        e.preventDefault();
        bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
        new bootstrap.Modal(document.getElementById('signupModal')).show();
    });
    document.getElementById('switchToLogin').addEventListener('click', (e) => {
        e.preventDefault();
        bootstrap.Modal.getInstance(document.getElementById('signupModal')).hide();
        new bootstrap.Modal(document.getElementById('loginModal')).show();
    });
}

// --- Map initialization ----------------------------------------------------

const map = new maplibregl.Map({
    container: 'map',
    style: OSM_STYLE,
    bounds: US_BOUNDS,
    fitBoundsOptions: { padding: 40 }
});

const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserLocation: true
});
map.addControl(geolocate, 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

const LAYER_IDS = {
    'random-points': ['random-points-layer'],
    'h3-hexes': ['h3-hexes-fill', 'h3-hexes-line'],
    'observations': ['observations-layer'],
};

// --- Sources + layers (after style load) ----------------------------------

map.on('load', () => {
    // Observations (user's saved pins)
    map.addSource('observations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
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

    // Random demo points
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

    // H3 hexes
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

    // User's H3 cell from geolocation
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
    wireAuthForms();
    wireObservationFlow();
    wireDeleteFlow();
    fetchAuthState().then(() => {
        if (currentUser) loadObservations();
    });
});

// --- Layer panel sync ------------------------------------------------------

function initLayerPanels() {
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

    document.querySelectorAll('.js-add-random-points').forEach(btn => {
        btn.addEventListener('click', addRandomPoints);
    });
    document.querySelectorAll('.js-clear-demo').forEach(btn => {
        btn.addEventListener('click', clearDemo);
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

// --- FABs ------------------------------------------------------------------

function wireFabs() {
    document.getElementById('fabGeolocate').addEventListener('click', () => {
        geolocate.trigger();
    });
    document.getElementById('fabPrimary').addEventListener('click', startObservation);
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
        const queryable = ['observations-layer', 'random-points-layer', 'h3-hexes-fill']
            .filter(id => map.getLayer(id));
        const features = map.queryRenderedFeatures(e.point, { layers: queryable });
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
        document.querySelectorAll('.user-location-info').forEach(el => { el.innerHTML = html; });
    });
    geolocate.on('error', () => {
        document.querySelectorAll('.user-location-info').forEach(el => {
            el.innerHTML = '<em class="text-warning-emphasis">Could not get your location.</em>';
        });
    });
}

// --- Observation flow -----------------------------------------------------

let openPopup = null;

function showObservationPopup(feature) {
    const p = feature.properties;
    const coords = feature.geometry.coordinates;
    const species = p.species_name || '(no species)';
    const when = new Date(p.recorded_at).toLocaleString();
    const notes = p.notes ? `<div class="popup-notes">${escapeHtml(p.notes)}</div>` : '';

    const html = `
        <div class="observation-popup">
            <div class="popup-species">${escapeHtml(species)}</div>
            <div class="popup-meta">${when}</div>
            ${notes}
            <div class="popup-h3">res 8 · ${p.h3_cell_res_8}</div>
            <div class="popup-actions">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit">
                    <i class="bi bi-pencil"></i> Edit
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete">
                    <i class="bi bi-trash"></i> Delete
                </button>
            </div>
        </div>
    `;

    if (openPopup) openPopup.remove();
    openPopup = new maplibregl.Popup({ offset: 14, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

    const root = openPopup.getElement();
    root.querySelector('[data-action="edit"]').addEventListener('click', () => {
        openPopup.remove();
        openPopup = null;
        startEditObservation(feature);
    });
    root.querySelector('[data-action="delete"]').addEventListener('click', () => {
        openPopup.remove();
        openPopup = null;
        startDeleteObservation(feature);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// --- Create-mode entry ----------------------------------------------------

function startObservation() {
    if (!currentUser) {
        new bootstrap.Modal(document.getElementById('loginModal')).show();
        return;
    }
    observationMode = 'create';
    editingObservationId = null;
    pendingCoords = null;

    const form = document.getElementById('observationForm');
    form.reset();
    form.querySelector('input[name="id"]').value = '';
    document.getElementById('observationModalLabel').textContent = 'New observation';
    document.getElementById('observationError').classList.add('d-none');
    document.getElementById('obsLocation').textContent = 'acquiring GPS…';
    document.getElementById('obsAccuracy').textContent = '—';
    document.getElementById('obsTime').textContent = new Date().toLocaleString();
    document.getElementById('observationSubmit').disabled = true;
    document.getElementById('observationSubmit').textContent = 'Save observation';
    document.getElementById('obsEditHints').classList.add('d-none');
    document.getElementById('obsRecaptureWrap').classList.add('d-none');
    removeEditMarker();

    new bootstrap.Modal(document.getElementById('observationModal')).show();
    captureCurrentGPS();
}

// --- Edit-mode entry ------------------------------------------------------

function startEditObservation(feature) {
    observationMode = 'edit';
    editingObservationId = feature.properties.id || feature.id;
    pendingCoords = {
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        accuracy: feature.properties.accuracy_meters,
    };

    const form = document.getElementById('observationForm');
    form.reset();
    form.querySelector('input[name="id"]').value = editingObservationId;
    form.querySelector('input[name="species_name"]').value = feature.properties.species_name || '';
    form.querySelector('textarea[name="notes"]').value = feature.properties.notes || '';

    document.getElementById('observationModalLabel').textContent = 'Edit observation';
    document.getElementById('observationError').classList.add('d-none');
    updateLocationDisplay();
    document.getElementById('obsTime').textContent =
        new Date(feature.properties.recorded_at).toLocaleString();
    document.getElementById('observationSubmit').disabled = false;
    document.getElementById('observationSubmit').textContent = 'Save changes';
    document.getElementById('obsEditHints').classList.remove('d-none');
    document.getElementById('obsRecaptureWrap').classList.remove('d-none');

    // Add a draggable marker the user can use to reposition
    addEditMarker(pendingCoords.longitude, pendingCoords.latitude);

    new bootstrap.Modal(document.getElementById('observationModal')).show();
}

function updateLocationDisplay() {
    if (!pendingCoords) return;
    document.getElementById('obsLocation').textContent =
        `${pendingCoords.latitude.toFixed(5)}, ${pendingCoords.longitude.toFixed(5)}`;
    document.getElementById('obsAccuracy').textContent =
        pendingCoords.accuracy != null ? `${Math.round(pendingCoords.accuracy)} m` : '—';
}

function captureCurrentGPS() {
    if (!navigator.geolocation) {
        const errEl = document.getElementById('observationError');
        errEl.textContent = 'Geolocation unsupported in this browser.';
        errEl.classList.remove('d-none');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            pendingCoords = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
            };
            updateLocationDisplay();
            document.getElementById('observationSubmit').disabled = false;
            // If editing, also move the marker
            if (observationMode === 'edit' && editMarker) {
                editMarker.setLngLat([pendingCoords.longitude, pendingCoords.latitude]);
            }
        },
        (err) => {
            const errEl = document.getElementById('observationError');
            errEl.textContent = 'Could not get your location: ' + err.message;
            errEl.classList.remove('d-none');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function addEditMarker(lng, lat) {
    removeEditMarker();
    const el = document.createElement('div');
    el.className = 'observation-edit-marker';
    el.innerHTML = `
        <div style="
            width: 28px; height: 28px; border-radius: 50%;
            background: #d96d2a; border: 3px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        "></div>
    `;
    editMarker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
    editMarker.on('dragend', () => {
        const ll = editMarker.getLngLat();
        pendingCoords = {
            latitude: ll.lat,
            longitude: ll.lng,
            accuracy: pendingCoords?.accuracy ?? null,
        };
        updateLocationDisplay();
    });
}

function removeEditMarker() {
    if (editMarker) {
        editMarker.remove();
        editMarker = null;
    }
}

// --- Form submit (handles both create and edit) ---------------------------

function wireObservationFlow() {
    document.getElementById('observationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pendingCoords) return;
        const fd = new FormData(e.target);
        const id = fd.get('id');

        const errEl = document.getElementById('observationError');
        errEl.classList.add('d-none');

        const isEdit = observationMode === 'edit' && id;
        const url = isEdit ? `/api/v1/observations/${id}/` : '/api/v1/observations/';
        const method = isEdit ? 'PATCH' : 'POST';

        const payload = {
            species_name: fd.get('species_name') || '',
            notes: fd.get('notes') || '',
            location: {
                type: 'Point',
                coordinates: [pendingCoords.longitude, pendingCoords.latitude],
            },
        };
        if (!isEdit) {
            payload.accuracy_meters = pendingCoords.accuracy;
            payload.recorded_at = new Date().toISOString();
        } else if (pendingCoords.accuracy != null) {
            payload.accuracy_meters = pendingCoords.accuracy;
        }

        const resp = await apiFetch(url, {
            method,
            body: JSON.stringify(payload),
        });

        if (resp.ok) {
            bootstrap.Modal.getInstance(document.getElementById('observationModal')).hide();
            removeEditMarker();
            observationMode = null;
            editingObservationId = null;
            await loadObservations();
            showToast(isEdit ? 'Observation updated' : 'Observation saved', 'success');
        } else {
            const data = await resp.json().catch(() => ({}));
            errEl.textContent = JSON.stringify(data);
            errEl.classList.remove('d-none');
            showToast(isEdit ? 'Could not update observation' : 'Could not save observation', 'error');
        }
    });

    // Re-capture GPS button (edit mode)
    document.getElementById('obsRecaptureBtn').addEventListener('click', () => {
        captureCurrentGPS();
    });

    // Reset edit state when the modal is dismissed
    document.getElementById('observationModal').addEventListener('hidden.bs.modal', () => {
        removeEditMarker();
        observationMode = null;
        editingObservationId = null;
    });
}

// --- Delete flow ----------------------------------------------------------

let pendingDeleteId = null;

function startDeleteObservation(feature) {
    pendingDeleteId = feature.properties.id || feature.id;
    const p = feature.properties;
    const species = p.species_name || '(no species)';
    const when = new Date(p.recorded_at).toLocaleString();
    document.getElementById('deletePreview').innerHTML = `
        <strong>${escapeHtml(species)}</strong><br>${when}
    `;
    new bootstrap.Modal(document.getElementById('deleteModal')).show();
}

function wireDeleteFlow() {
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        const resp = await apiFetch(`/api/v1/observations/${pendingDeleteId}/`, {
            method: 'DELETE',
        });
        bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
        if (resp.ok || resp.status === 204) {
            await loadObservations();
            showToast('Observation deleted', 'success');
        } else {
            showToast('Could not delete observation', 'error');
        }
        pendingDeleteId = null;
    });
}

// --- Load and render observations -----------------------------------------

async function loadObservations() {
    if (!currentUser) return;
    const resp = await apiFetch('/api/v1/observations/');
    if (!resp.ok) return;
    const data = await resp.json();
    map.getSource('observations')?.setData(data);
    renderSavedList(data);
}

function renderSavedList(featureCollection) {
    const el = document.getElementById('savedPanelBody');
    if (!featureCollection.features.length) {
        el.innerHTML = '<div class="text-muted">No observations yet. Tap the + button on the map to add one.</div>';
        return;
    }
    el.innerHTML = featureCollection.features.map(f => {
        const p = f.properties;
        const coords = f.geometry.coordinates;
        const species = p.species_name || '(no species)';
        const when = new Date(p.recorded_at).toLocaleDateString();
        const notes = p.notes ? `<div class="text-muted small mt-1">${p.notes}</div>` : '';
        return `
            <div class="saved-item border-bottom py-2"
                 data-lng="${coords[0]}" data-lat="${coords[1]}">
                <div class="d-flex justify-content-between">
                    <strong>${species}</strong>
                    <small class="text-muted">${when}</small>
                </div>
                ${notes}
                <div class="small text-muted mt-1">
                    H3-8: <code>${p.h3_cell_res_8}</code>
                </div>
            </div>
        `;
    }).join('');

    el.querySelectorAll('.saved-item').forEach(item => {
        item.addEventListener('click', () => {
            const lng = parseFloat(item.dataset.lng);
            const lat = parseFloat(item.dataset.lat);
            map.flyTo({ center: [lng, lat], zoom: 14 });
            setMode('map');
        });
    });
}

// --- Mode tabs ------------------------------------------------------------

function setMode(mode) {
    if (mode === 'layers') return; // sheet trigger, not a persistent mode

    document.querySelectorAll('.app-tab, .dock-tab').forEach(t => {
        if (t.dataset.mode === 'layers') return;
        t.classList.toggle('active', t.dataset.mode === mode);
    });

    const savedPanel = document.getElementById('savedPanel');
    if (mode === 'saved') {
        savedPanel.classList.remove('d-none');
        loadObservations(); // refresh on every view
    } else {
        savedPanel.classList.add('d-none');
    }
}
window.setMode = setMode;

function wireDockTabs() {
    document.querySelectorAll('.app-tab, .dock-tab').forEach(tab => {
        tab.addEventListener('click', () => setMode(tab.dataset.mode));
    });
}

