// =============================================================================
// HTTP helpers + CSRF + toast notifications
// =============================================================================

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
}

function csrfHeaders() {
    const token = getCookie('csrftoken');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-CSRFToken'] = token;
    return headers;
}

/**
 * Fetch wrapper that always sends cookies + the CSRF token and JSON content type.
 * Use this for every same-origin API call.
 */
export async function apiFetch(url, options = {}) {
    return fetch(url, {
        credentials: 'same-origin',
        headers: csrfHeaders(),
        ...options,
    });
}

/**
 * Tiny HTML-escape helper for building popup content safely.
 */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * Show a transient Bootstrap toast.
 *  kind: 'info' | 'success' | 'error'
 */
export function showToast(message, kind = 'info') {
    const toastEl = document.getElementById('appToast');
    const bodyEl = document.getElementById('appToastBody');
    toastEl.classList.remove('text-bg-dark', 'text-bg-success', 'text-bg-danger');
    if (kind === 'success') toastEl.classList.add('text-bg-success');
    else if (kind === 'error') toastEl.classList.add('text-bg-danger');
    else toastEl.classList.add('text-bg-dark');
    bodyEl.textContent = message;
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}