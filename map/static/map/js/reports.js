// =============================================================================
// Reports: the current user's waterbody comments
// =============================================================================

import { apiFetch, escapeHtml } from './api.js';
import { state } from './state.js';

export async function loadReports() {
    const el = document.getElementById('reportsPanelBody');
    if (!el) return;

    if (!state.currentUser) {
        el.innerHTML = '<div class="text-muted">Sign in to see your water reports.</div>';
        return;
    }

    el.innerHTML = '<div class="text-muted">Loading…</div>';

    const resp = await apiFetch('/api/v1/waterbody-comments/');
    if (!resp.ok) {
        el.innerHTML = '<div class="text-danger">Could not load reports.</div>';
        return;
    }

    const data = await resp.json();
    const comments = Array.isArray(data) ? data : (data.results ?? []);

    if (!comments.length) {
        el.innerHTML = '<div class="text-muted">No reports yet. Click a lake or stream on the map and leave a comment.</div>';
        return;
    }

    el.innerHTML = comments.map(c => {
        const name = c.gnis_name || `GNIS ${c.gnis_id}`;
        const when = new Date(c.created_at).toLocaleDateString();
        return `
            <div class="saved-item border-bottom py-2" data-gnis-id="${escapeHtml(c.gnis_id)}">
                <div class="d-flex justify-content-between align-items-start">
                    <strong>${escapeHtml(name)}</strong>
                    <small class="text-muted ms-2 text-nowrap">${when}</small>
                </div>
                <div class="mt-1">${escapeHtml(c.body)}</div>
                <button class="btn btn-sm btn-link text-danger p-0 mt-1 delete-report-btn"
                        data-comment-id="${escapeHtml(c.id)}"
                        style="font-size:0.75rem;">Delete</button>
            </div>
        `;
    }).join('');

    el.querySelectorAll('.delete-report-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.commentId;
            const resp = await apiFetch(`/api/v1/waterbody-comments/${id}/`, { method: 'DELETE' });
            if (resp.ok || resp.status === 204) {
                await loadReports();
            }
        });
    });
}