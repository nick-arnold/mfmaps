// =============================================================================
// Observations: create, edit, delete, popup, H3 aggregation, list view
// =============================================================================

import { state } from './state.js';
import { apiFetch, showToast, escapeHtml } from './api.js';
import { zoomToH3Res, isLayerGroupVisible } from './map-setup.js';

// --- Module state ---------------------------------------------------------

let observationMode = null;      // 'create' | 'edit' | 'edit-drag' | null
let editingObservationId = null;
let editMarker = null;
let pendingCoords = null;        // { latitude, longitude, accuracy }
let pendingDeleteId = null;
let editFormSnapshot = null;

// Latest observations cached locally so we can recompute H3 aggregation on zoom
let cachedObservations = { type: 'FeatureCollection', features: [] };

// --- Map click + zoom handlers -------------------------------------------

export function wireMapClicks() {
    state.map.on('click', 'observations-layer', (e) => {
        if (state.queryMode) return;
        if (!e.features?.length) return;
        showObservationPopup(e.features[0]);
    });

    state.map.on('mouseenter', 'observations-layer', () => {
        if (!state.queryMode) state.map.getCanvas().style.cursor = 'pointer';
    });
    state.map.on('mouseleave', 'observations-layer', () => {
        if (!state.queryMode) state.map.getCanvas().style.cursor = '';
    });

    // Recompute H3 aggregation when zoom changes
    state.map.on('zoomend', () => {
        if (isLayerGroupVisible('h3-hexes')) {
            recomputeH3();
        }
    });

    // Recompute H3 when the toggle is flipped on
    document.body.addEventListener('change', (e) => {
        if (e.target.matches('.layer-toggle[data-layer-group="h3-hexes"]') && e.target.checked) {
            recomputeH3();
        }
    });
}

// --- Popup ----------------------------------------------------------------

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
            <div class="popup-h3">res 10 · ${p.h3_cell_res_10}</div>
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

    if (state.openPopup) state.openPopup.remove();
    state.openPopup = new maplibregl.Popup({ offset: 14, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(state.map);

    const root = state.openPopup.getElement();
    root.querySelector('[data-action="edit"]').addEventListener('click', () => {
        state.openPopup.remove();
        state.openPopup = null;
        startEditObservation(feature);
    });
    root.querySelector('[data-action="delete"]').addEventListener('click', () => {
        state.openPopup.remove();
        state.openPopup = null;
        startDeleteObservation(feature);
    });
}

// --- Create mode ----------------------------------------------------------

export function startObservation() {
    if (!state.currentUser) {
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
    removeEditMarker();

    new bootstrap.Modal(document.getElementById('observationModal')).show();
    captureCurrentGPS();
}

// --- Edit mode ------------------------------------------------------------

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

    new bootstrap.Modal(document.getElementById('observationModal')).show();
}

// --- Drag phase -----------------------------------------------------------

function enterDragMode() {
    if (observationMode !== 'edit') return;

    const form = document.getElementById('observationForm');
    editFormSnapshot = {
        species_name: form.querySelector('input[name="species_name"]').value,
        notes: form.querySelector('textarea[name="notes"]').value,
        coords: { ...pendingCoords },
    };

    observationMode = 'edit-drag';

    const modalEl = document.getElementById('observationModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();

    addEditMarker(pendingCoords.longitude, pendingCoords.latitude);
    showDragTooltip();
    state.map.flyTo({
        center: [pendingCoords.longitude, pendingCoords.latitude],
        zoom: Math.max(state.map.getZoom(), 14),
    });
}

function showDragTooltip() {
    const tooltip = document.getElementById('dragTooltip');
    tooltip.classList.remove('d-none');
    positionDragTooltip();
    updateDragTooltipCoords();
}

function hideDragTooltip() {
    document.getElementById('dragTooltip').classList.add('d-none');
}

function positionDragTooltip() {
    if (!editMarker) return;
    const tooltip = document.getElementById('dragTooltip');
    const lngLat = editMarker.getLngLat();
    const point = state.map.project(lngLat);
    tooltip.style.left = `${point.x}px`;
    tooltip.style.top = `${point.y}px`;
}

function updateDragTooltipCoords() {
    if (!pendingCoords) return;
    document.getElementById('dragTooltipCoords').textContent =
        `${pendingCoords.latitude.toFixed(5)}, ${pendingCoords.longitude.toFixed(5)}`;
}

function exitDragMode(commit) {
    if (!commit && editFormSnapshot) {
        pendingCoords = editFormSnapshot.coords;
    }
    hideDragTooltip();
    removeEditMarker();
    observationMode = 'edit';
    updateLocationDisplay();
    new bootstrap.Modal(document.getElementById('observationModal')).show();
    editFormSnapshot = null;
}

function updateLocationDisplay() {
    if (!pendingCoords) return;
    document.getElementById('obsLocation').textContent =
        `${pendingCoords.latitude.toFixed(5)}, ${pendingCoords.longitude.toFixed(5)}`;
    document.getElementById('obsAccuracy').textContent =
        pendingCoords.accuracy != null ? `${Math.round(pendingCoords.accuracy)} m` : '—';
}

// --- GPS capture ----------------------------------------------------------

function captureCurrentGPS() {
    if (!navigator.geolocation) {
        showToast('Geolocation unsupported in this browser.', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            pendingCoords = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
            };
            if (observationMode === 'edit-drag' && editMarker) {
                editMarker.setLngLat([pendingCoords.longitude, pendingCoords.latitude]);
                state.map.flyTo({ center: [pendingCoords.longitude, pendingCoords.latitude] });
                positionDragTooltip();
                updateDragTooltipCoords();
            } else {
                updateLocationDisplay();
                document.getElementById('observationSubmit').disabled = false;
            }
        },
        (err) => {
            showToast('Could not get your location: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// --- Edit marker ----------------------------------------------------------

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
        .addTo(state.map);

    editMarker.on('drag', () => {
        const ll = editMarker.getLngLat();
        pendingCoords = {
            latitude: ll.lat,
            longitude: ll.lng,
            accuracy: pendingCoords?.accuracy ?? null,
        };
        positionDragTooltip();
        updateDragTooltipCoords();
    });

    editMarker.on('dragend', positionDragTooltip);
    state.map.on('move', positionDragTooltip);
}

function removeEditMarker() {
    if (editMarker) {
        editMarker.remove();
        editMarker = null;
    }
    state.map.off('move', positionDragTooltip);
}

// --- Delete flow ----------------------------------------------------------

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

// --- Form wiring ----------------------------------------------------------

export function initObservationForms() {
    document.getElementById('observationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pendingCoords) return;
        const fd = new FormData(e.target);
        const id = editingObservationId;

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

    document.getElementById('obsEditHints').addEventListener('click', enterDragMode);
    document.getElementById('obsEditHints').style.cursor = 'pointer';

    document.getElementById('dragDone').addEventListener('click', () => exitDragMode(true));
    document.getElementById('dragCancel').addEventListener('click', () => exitDragMode(false));
    document.getElementById('dragRecapture').addEventListener('click', () => captureCurrentGPS());

    document.getElementById('observationModal').addEventListener('hidden.bs.modal', () => {
        if (observationMode === 'edit-drag') return;
        removeEditMarker();
        hideDragTooltip();
        observationMode = null;
        editingObservationId = null;
        editFormSnapshot = null;
    });

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

// --- Load + render --------------------------------------------------------

export async function loadObservations() {
    // Close any open popup so it doesn't show stale data after edits
    if (state.openPopup) {
        state.openPopup.remove();
        state.openPopup = null;
    }

    if (!state.currentUser) {
        cachedObservations = { type: 'FeatureCollection', features: [] };
        state.map.getSource('observations')?.setData(cachedObservations);
        state.map.getSource('h3-hexes')?.setData(cachedObservations);
        renderSavedList(cachedObservations);
        return;
    }

    const resp = await apiFetch('/api/v1/observations/');
    if (!resp.ok) return;
    const data = await resp.json();

    // MapLibre strips feature.id in queryRenderedFeatures results;
    // copy it into properties so we can read it back on click.
    data.features.forEach(f => {
        if (f.id != null && f.properties && f.properties.id == null) {
            f.properties.id = f.id;
        }
    });

    cachedObservations = data;
    state.map.getSource('observations')?.setData(data);
    recomputeH3();
    renderSavedList(data);
}

// --- H3 aggregation from observations -------------------------------------

function recomputeH3() {
    const source = state.map.getSource('h3-hexes');
    if (!source) return;
    console.log('recomputeH3 running, observations:', cachedObservations.features.length, 'zoom:', state.map.getZoom());
    const features = cachedObservations.features;
    if (!features.length) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    const res = zoomToH3Res(state.map.getZoom());

    // Aggregate each observation's res-10 cell up to the current display resolution
    const cellCounts = new Map();
    for (const f of features) {
        const fineCell = f.properties.h3_cell_res_10;
        if (!fineCell) continue;
        const displayCell = res >= 10 ? fineCell : h3.cellToParent(fineCell, res);
        cellCounts.set(displayCell, (cellCounts.get(displayCell) || 0) + 1);
    }

    const hexFeatures = [];
    cellCounts.forEach((count, cell) => {
        const boundary = h3.cellToBoundary(cell, false).map(([lat, lng]) => [lng, lat]);
        boundary.push(boundary[0]);
        hexFeatures.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [boundary] },
            properties: { h3: cell, count, resolution: res },
        });
    });
    console.log('hexFeatures count:', hexFeatures.length, hexFeatures);
    source.setData({ type: 'FeatureCollection', features: hexFeatures });
}

// --- Saved list view ------------------------------------------------------

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
        const notes = p.notes ? `<div class="text-muted small mt-1">${escapeHtml(p.notes)}</div>` : '';
        return `
            <div class="saved-item border-bottom py-2"
                 data-lng="${coords[0]}" data-lat="${coords[1]}">
                <div class="d-flex justify-content-between">
                    <strong>${escapeHtml(species)}</strong>
                    <small class="text-muted">${when}</small>
                </div>
                ${notes}
                <div class="small text-muted mt-1">
                    H3-10: <code>${p.h3_cell_res_10}</code>
                </div>
            </div>
        `;
    }).join('');

    el.querySelectorAll('.saved-item').forEach(item => {
        item.addEventListener('click', () => {
            const lng = parseFloat(item.dataset.lng);
            const lat = parseFloat(item.dataset.lat);
            state.map.flyTo({ center: [lng, lat], zoom: 14 });
            window.setMode('map');
        });
    });
}