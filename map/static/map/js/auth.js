// =============================================================================
// Authentication: login, signup, logout, session state, account menus
// =============================================================================

import { apiFetch, showToast } from './api.js';
import { state } from './state.js';

// Called by observations.js after login/logout to refresh pins
let onAuthChange = () => {};

export function setAuthChangeHandler(fn) {
    onAuthChange = fn;
}

// --- Session state --------------------------------------------------------

export async function fetchAuthState() {
    try {
        const resp = await apiFetch('/_allauth/browser/v1/auth/session');
        if (resp.ok) {
            const data = await resp.json();
            state.currentUser = data.data?.user
                ? { email: data.data.user.email, id: data.data.user.id }
                : null;
        } else {
            state.currentUser = null;
        }
    } catch (e) {
        state.currentUser = null;
    }
    renderAccountMenus();
}

function renderAccountMenus() {
    const html = state.currentUser
        ? `
            <li class="dropdown-header small text-muted">Signed in as</li>
            <li class="dropdown-item-text small fw-bold text-truncate" style="max-width:240px">${state.currentUser.email}</li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="#" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
          `
        : `
            <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#loginModal"><i class="bi bi-box-arrow-in-right me-2"></i>Sign in</a></li>
            <li><a class="dropdown-item" href="#" data-bs-toggle="modal" data-bs-target="#signupModal"><i class="bi bi-person-plus me-2"></i>Create account</a></li>
          `;

    document.querySelectorAll('#accountMenu, #accountMenuMobile').forEach(el => {
        el.innerHTML = html;
    });

    document.querySelectorAll('[data-action="logout"]').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            await logout();
        });
    });
}

// --- Auth actions ---------------------------------------------------------

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
    return { ok: false, error: data?.errors?.[0]?.message || 'Sign in failed' };
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
    return { ok: false, error: data?.errors?.[0]?.message || 'Sign up failed' };
}

async function logout() {
    await apiFetch('/_allauth/browser/v1/auth/session', { method: 'DELETE' });
    await fetchAuthState();
    onAuthChange();
    showToast('Signed out', 'info');
}

// --- Wire form handlers ---------------------------------------------------

export function initAuth() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = document.getElementById('loginError');
        errEl.classList.add('d-none');
        const result = await login(fd.get('email'), fd.get('password'));
        if (result.ok) {
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            e.target.reset();
            showToast(`Signed in as ${state.currentUser.email}`, 'success');
            onAuthChange();
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
            showToast(`Account created — welcome, ${state.currentUser.email}`, 'success');
            onAuthChange();
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