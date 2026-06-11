// =============================================================================
// Reports: waterbody comments — "Mine" and "Public" sub-tabs
// =============================================================================

import { apiFetch, escapeHtml } from './api.js';
import { state } from './state.js';

let currentScope = 'mine';

export async function loadReports() {
    wireReportsTabs();
    await render();
}

function wireReportsTabs() {
    if (wireReportsTabs._wired) return;
    wireReportsTabs._wired = true;
    document.querySelectorAll('#reportsTabs [data-reports-scope]').forEach(btn => {
        btn.addEventListener('click', async () => {
            currentScope = btn.dataset.reportsScope;
            document.querySelectorAll('#reportsTabs .nav-link').forEach(b => {
                b.classList.toggle('active', b === btn);
            });
            await render();
        });
    });
}

async function render() {
    const el = document.getElementById('reportsPanelBody');
    if (!el) return;

    if (currentScope === 'mine' && !state.currentUser) {
        el.innerHTML = '<div class="text-muted p-2">Sign in to see your water reports.</div>';
        return;
    }

    el.innerHTML = '<div class="text-muted p-2">Loading…</div>';

    const url = currentScope === 'public'
        ? '/api/v1/waterbody-comments/?scope=public'
        : '/api/v1/waterbody-comments/';

    const resp = await apiFetch(url);
    if (!resp.ok) {
        el.innerHTML = '<div class="text-danger p-2">Could not load reports.</div>';
        return;
    }

    const data = await resp.json();
    const comments = Array.isArray(data) ? data : (data.results ?? []);

    if (!comments.length) {
        el.innerHTML = currentScope === 'public'
            ? '<div class="text-muted p-2">No public reports yet.</div>'
            : '<div class="text-muted p-2">No reports yet. Click a lake or stream on the map and leave a comment.</div>';
        return;
    }

    el.innerHTML = comments.map(c => renderItem(c, currentScope)).join('');

    el.querySelectorAll('.report-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.report-actions')) return;
            if (e.target.closest('.report-edit-form')) return;
            const lng = parseFloat(item.dataset.lng);
            const lat = parseFloat(item.dataset.lat);
            if (!isFinite(lng) || !isFinite(lat)) return;

            const gnisId = item.dataset.gnisId;
            const fragments = [
                ...state.map.querySourceFeatures('nhd_conus', {
                    sourceLayer: 'waterbodies',
                    filter: ['==', ['get', 'gnis_id'], gnisId]
                }),
                ...state.map.querySourceFeatures('nhd_conus', {
                    sourceLayer: 'streams',
                    filter: ['==', ['get', 'gnis_id'], gnisId]
                }),
                ...state.map.querySourceFeatures('nhd_ak', {
                    sourceLayer: 'waterbodies',
                    filter: ['==', ['get', 'gnis_id'], gnisId]
                }),
                ...state.map.querySourceFeatures('nhd_ak', {
                    sourceLayer: 'streams',
                    filter: ['==', ['get', 'gnis_id'], gnisId]
                }),
            ];

            if (fragments.length) {
                const lngs = [], lats = [];
                for (const f of fragments) collectCoords(f.geometry, lngs, lats);
                state.map.fitBounds(
                    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                    { padding: 80, maxZoom: 13 }
                );
            } else {
                // Feature not in tile cache — fly to click point; tiles will load
                state.map.flyTo({ center: [lng, lat], zoom: 11 });
            }

            window.setMode('map');
        });
    });

    if (currentScope === 'mine') {
        el.querySelectorAll('.delete-report-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.commentId;
                const resp = await apiFetch(`/api/v1/waterbody-comments/${id}/`, { method: 'DELETE' });
                if (resp.ok || resp.status === 204) await render();
            });
        });

        el.querySelectorAll('.edit-report-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = btn.closest('.report-item');
                item.querySelector('.report-display').classList.add('d-none');
                item.querySelector('.report-edit-form').classList.remove('d-none');
            });
        });

        el.querySelectorAll('.report-edit-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = btn.closest('.report-item');
                item.querySelector('.report-edit-form').classList.add('d-none');
                item.querySelector('.report-display').classList.remove('d-none');
            });
        });

        el.querySelectorAll('.report-edit-save').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.report-item');
                const id = btn.dataset.commentId;
                const newBody = item.querySelector('.report-edit-body').value.trim();
                const newPublic = item.querySelector('.report-edit-public').checked;
                const errEl = item.querySelector('.report-edit-error');
                errEl.classList.add('d-none');
                if (!newBody) return;
                btn.disabled = true;
                try {
                    const resp = await apiFetch(`/api/v1/waterbody-comments/${id}/`, {
                        method: 'PATCH',
                        body: JSON.stringify({ body: newBody, is_public: newPublic }),
                    });
                    if (resp.ok) {
                        await render();
                    } else {
                        errEl.textContent = 'Could not update.';
                        errEl.classList.remove('d-none');
                    }
                } catch {
                    errEl.textContent = 'Network error.';
                    errEl.classList.remove('d-none');
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }
}

// --- Helpers --------------------------------------------------------------

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

function renderItem(c, scope) {
    const name = c.gnis_name || `GNIS ${c.gnis_id}`;
    const when = new Date(c.created_at).toLocaleDateString();
    const hasCoords = c.click_lng != null && c.click_lat != null;

    const meta = scope === 'public'
        ? `<small class="text-muted">by ${escapeHtml(c.username)} · ${when}</small>`
        : `<small class="text-muted text-nowrap">${when}</small>`;

    const badge = scope === 'mine'
        ? (c.is_public === false
            ? '<span class="badge bg-secondary ms-2" style="font-size:0.65rem;">private</span>'
            : '<span class="badge bg-success ms-2" style="font-size:0.65rem;">public</span>')
        : '';

    const actions = scope === 'mine'
        ? `<div class="report-actions mt-1">
               <button class="btn btn-sm btn-link p-0 me-2 edit-report-btn"
                       data-comment-id="${escapeHtml(c.id)}"
                       style="font-size:0.75rem;">Edit</button>
               <button class="btn btn-sm btn-link text-danger p-0 delete-report-btn"
                       data-comment-id="${escapeHtml(c.id)}"
                       style="font-size:0.75rem;">Delete</button>
           </div>`
        : '';

    const editForm = scope === 'mine'
        ? `<div class="report-edit-form d-none mt-2">
               <textarea class="form-control form-control-sm report-edit-body" rows="2" maxlength="1000"
                   style="resize:none;font-size:0.8rem;">${escapeHtml(c.body)}</textarea>
               <div class="d-flex align-items-center justify-content-between mt-1 gap-2">
                   <div class="form-check form-check-inline m-0">
                       <input class="form-check-input report-edit-public" type="checkbox" ${c.is_public ? 'checked' : ''}>
                       <label class="form-check-label small text-muted" style="font-size:0.72rem;">Public</label>
                   </div>
                   <div>
                       <button class="btn btn-sm btn-link text-muted report-edit-cancel" style="font-size:0.75rem;">Cancel</button>
                       <button class="btn btn-sm btn-outline-secondary report-edit-save"
                           data-comment-id="${escapeHtml(c.id)}"
                           style="font-size:0.75rem;">Update</button>
                   </div>
               </div>
               <div class="report-edit-error text-danger small mt-1 d-none" style="font-size:0.72rem;"></div>
           </div>`
        : '';

    return `
        <div class="report-item saved-item border-bottom py-2 px-2"
             data-gnis-id="${escapeHtml(c.gnis_id)}"
             data-lng="${hasCoords ? c.click_lng : ''}"
             data-lat="${hasCoords ? c.click_lat : ''}"
             style="${hasCoords ? 'cursor:pointer;' : ''}">
            <div class="report-display">
                <div class="d-flex justify-content-between align-items-start">
                    <div><strong>${escapeHtml(name)}</strong>${badge}</div>
                    ${meta}
                </div>
                <div class="mt-1">${escapeHtml(c.body)}</div>
                ${actions}
            </div>
            ${editForm}
        </div>
    `;
}