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

    if (currentScope === 'mine') {
        el.querySelectorAll('.delete-report-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.commentId;
                const resp = await apiFetch(`/api/v1/waterbody-comments/${id}/`, { method: 'DELETE' });
                if (resp.ok || resp.status === 204) await render();
            });
        });
    }
}

function renderItem(c, scope) {
    const name = c.gnis_name || `GNIS ${c.gnis_id}`;
    const when = new Date(c.created_at).toLocaleDateString();

    const meta = scope === 'public'
        ? `<small class="text-muted">by ${escapeHtml(c.username)} · ${when}</small>`
        : `<small class="text-muted text-nowrap">${when}</small>`;

    const badge = scope === 'mine'
        ? (c.is_public === false
            ? '<span class="badge bg-secondary ms-2" style="font-size:0.65rem;">private</span>'
            : '<span class="badge bg-success ms-2" style="font-size:0.65rem;">public</span>')
        : '';

    const deleteBtn = scope === 'mine'
        ? `<button class="btn btn-sm btn-link text-danger p-0 mt-1 delete-report-btn"
                   data-comment-id="${escapeHtml(c.id)}"
                   style="font-size:0.75rem;">Delete</button>`
        : '';

    return `
        <div class="saved-item border-bottom py-2 px-2" data-gnis-id="${escapeHtml(c.gnis_id)}">
            <div class="d-flex justify-content-between align-items-start">
                <div><strong>${escapeHtml(name)}</strong>${badge}</div>
                ${meta}
            </div>
            <div class="mt-1">${escapeHtml(c.body)}</div>
            ${deleteBtn}
        </div>
    `;
}