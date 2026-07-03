// =============================================================================
// Tree species picker modal + button wiring
// -----------------------------------------------------------------------------
// Loads all three region legends, presents a searchable multi-select modal,
// persists selection to localStorage via state helpers, and triggers a reload
// of the species raster sources so the speciesfilter:// protocol re-composites.
// =============================================================================

import { state, saveTreeSpeciesSelection } from './state.js';
import { escapeHtml } from './api.js';
import {
    getTreeSpeciesRegions,
    reloadSpeciesFilterSources,
} from './map-setup.js';

// Flat list of all species across regions: [{ region, code, name, hex }]
let _catalog = null;
let _catalogPromise = null;

async function loadCatalog() {
    if (_catalog) return _catalog;
    if (_catalogPromise) return _catalogPromise;

    _catalogPromise = (async () => {
        const regions = getTreeSpeciesRegions();
        const results = await Promise.all(regions.map(async (r) => {
            try {
                const resp = await fetch(r.legendUrl);
                const raw = await resp.json();
                const src = raw.by_fortypcd || raw.by_evt_code || {};
                const rows = [];
                for (const [code, info] of Object.entries(src)) {
                    if (!info || !info.name) continue;
                    rows.push({
                        region: r.name,
                        code: String(code),
                        name: info.name,
                        hex: info.hex || '#888',
                    });
                }
                return rows;
            } catch (err) {
                console.warn(`Species catalog load failed for ${r.name}:`, err);
                return [];
            }
        }));
        _catalog = results.flat().sort((a, b) => a.name.localeCompare(b.name));
        return _catalog;
    })();

    return _catalogPromise;
}

const REGION_BADGE = {
    conus: { label: 'CONUS', cls: 'bg-secondary' },
    ak:    { label: 'AK',    cls: 'bg-info text-dark' },
    hi:    { label: 'HI',    cls: 'bg-warning text-dark' },
};

function renderRow(row, selected) {
    const badge = REGION_BADGE[row.region] || { label: row.region.toUpperCase(), cls: 'bg-secondary' };
    const key = `${row.region}:${row.code}`;
    const isChecked = selected.has(key);
    return `
        <label class="species-row d-flex align-items-center gap-2 py-2 px-2 border-bottom"
               data-key="${escapeHtml(key)}"
               style="cursor: pointer; user-select: none;">
            <input type="checkbox" class="form-check-input flex-shrink-0 m-0"
                   ${isChecked ? 'checked' : ''}>
            <span class="species-swatch flex-shrink-0"
                  style="display:inline-block;width:14px;height:14px;
                         background:${escapeHtml(row.hex)};
                         border:1px solid rgba(0,0,0,0.2);border-radius:2px;"></span>
            <span class="species-name flex-grow-1 small">${escapeHtml(row.name)}</span>
            <span class="badge ${badge.cls} small">${badge.label}</span>
        </label>
    `;
}

function renderList(container, catalog, query, selected) {
    const q = query.trim().toLowerCase();
    const filtered = q
        ? catalog.filter(r => r.name.toLowerCase().includes(q))
        : catalog;

    if (!filtered.length) {
        container.innerHTML = `<div class="p-3 text-muted small">No species match "${escapeHtml(query)}".</div>`;
        return;
    }

    // Simple render — a few thousand rows is fine for a one-shot innerHTML.
    container.innerHTML = filtered.map(r => renderRow(r, selected)).join('');
}

function updateCountBadges(count) {
    document.querySelectorAll('.species-picker-count').forEach(el => {
        if (count > 0) {
            el.textContent = String(count);
            el.classList.remove('d-none');
        } else {
            el.textContent = '';
            el.classList.add('d-none');
        }
    });
}

export async function initSpeciesPicker() {
    updateCountBadges(state.treeSpeciesSelection.size);

    // "Choose species" button — one lives in each layer panel (desktop + mobile)
    // and both share the same modal target.
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="open-species-picker"]');
        if (!btn) return;
        e.preventDefault();
        openModal();
    });

    async function openModal() {
        const modalEl = document.getElementById('speciesPickerModal');
        if (!modalEl) return;

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();

        const listEl = document.getElementById('speciesPickerList');
        const searchEl = document.getElementById('speciesPickerSearch');
        const countEl = document.getElementById('speciesPickerSelectedCount');

        listEl.innerHTML = '<div class="p-3 text-muted small">Loading…</div>';
        const catalog = await loadCatalog();

        // Working copy of selection — only committed on Done
        const working = new Set(state.treeSpeciesSelection);

        const updateCount = () => {
            countEl.textContent = working.size
                ? `${working.size} selected`
                : 'None selected';
        };
        updateCount();

        renderList(listEl, catalog, searchEl.value || '', working);

        // Search filter
        const onSearch = () => {
            renderList(listEl, catalog, searchEl.value || '', working);
        };
        searchEl.oninput = onSearch;

        // Row toggle (event delegation)
        listEl.onclick = (e) => {
            const label = e.target.closest('.species-row');
            if (!label) return;
            const key = label.dataset.key;
            if (!key) return;

            // Let the native checkbox toggle, then sync
            // (works whether user clicked the label or the checkbox itself)
            const cb = label.querySelector('input[type="checkbox"]');
            if (e.target !== cb) {
                // Manual toggle when clicking the label area
                cb.checked = !cb.checked;
            }
            if (cb.checked) working.add(key); else working.delete(key);
            updateCount();
        };

        // Clear all
        document.getElementById('speciesPickerClear').onclick = () => {
            working.clear();
            renderList(listEl, catalog, searchEl.value || '', working);
            updateCount();
        };

        // Done — commit
        document.getElementById('speciesPickerDone').onclick = () => {
            state.treeSpeciesSelection = working;
            saveTreeSpeciesSelection(working);
            updateCountBadges(working.size);
            reloadSpeciesFilterSources();
            modal.hide();
        };
    }
}