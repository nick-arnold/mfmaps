// =============================================================================
// Tree species picker modal + button wiring
// -----------------------------------------------------------------------------
// Loads all three region legends, presents a searchable multi-select modal
// with quick-select mushroom collections, persists selection to localStorage
// via state helpers, and triggers a reload of the species raster sources so
// the speciesfilter:// protocol re-composites.
// =============================================================================

import { state, saveTreeSpeciesSelection } from './state.js';
import { escapeHtml } from './api.js';
import {
    getTreeSpeciesRegions,
    reloadSpeciesFilterSources,
} from './map-setup.js';

// =============================================================================
// Mushroom → tree association collections
// =============================================================================
// Each collection defines name fragments matched case-insensitively against
// catalog entry names. A catalog entry matches if its lowercased name includes
// any fragment. Fragments are genus-level so they match across species
// (e.g. 'spruce' matches 'Engelmann spruce', 'Sitka spruce', etc.)
// =============================================================================

const MUSHROOM_COLLECTIONS = [
    {
        id: 'morel',
        label: 'Morel',
        icon: '🍄',
        description: 'Elm, ash, cottonwood, apple — and post-fire conifers: Douglas-fir, true firs, spruce, larch',
        match: [
            // Eastern hardwood morels — dying/dead host trees
            'american elm', 'slippery elm',
            'white ash', 'green ash', 'black ash',
            'black cottonwood', 'eastern cottonwood',
            'quaking aspen', 'bigtooth aspen',
            'apple',    // orchard and wild apple, reliable
            // Post-fire conifer morels
            'douglas-fir', 'douglas fir',
            'subalpine fir', 'grand fir', 'white fir', 'red fir', 'pacific silver fir',
            'engelmann spruce', 'sitka spruce', 'white spruce',
            'western larch', 'subalpine larch',
            'lodgepole pine',   // burns prolifically, good post-fire morel habitat
        ],
    },
    {
        id: 'chanterelle',
        label: 'Chanterelle',
        icon: '🟡',
        description: 'Douglas-fir, Sitka/Engelmann spruce, western hemlock, tanoak, white/red/chestnut oak, American beech',
        match: [
            // Western conifers
            'douglas-fir', 'douglas fir',
            'sitka spruce', 'engelmann spruce',
            'western hemlock',
            'tanoak', 'tan oak',
            // Eastern hardwoods
            'white oak', 'red oak', 'black oak', 'scarlet oak', 'chestnut oak',
            'american beech',
            'eastern hemlock',
            // West coast oaks
            'oregon white oak', 'california black oak',
        ],
    },
    {
        id: 'matsutake',
        label: 'Matsutake',
        icon: '⚪',
        description: 'Pine specialist — shore, lodgepole, ponderosa, white pine. Douglas-fir secondary in PNW.',
        match: [
            'shore pine', 'lodgepole pine',
            'ponderosa pine',
            'eastern white pine', 'western white pine',
            'red pine',
            'douglas-fir', 'douglas fir',
        ],
    },
    {
        id: 'porcini',
        label: 'Porcini',
        icon: '🍂',
        description: 'Subalpine conifers — Engelmann spruce, subalpine fir, larch — plus beech and oak at lower elevations',
        match: [
            // Subalpine conifers (B. rex-veris / king bolete core habitat)
            'engelmann spruce', 'sitka spruce', 'white spruce', 'red spruce',
            'subalpine fir', 'pacific silver fir',
            'western larch', 'subalpine larch',
            // Lower elevation (B. edulis complex)
            'ponderosa pine', 'lodgepole pine',
            'douglas-fir', 'douglas fir',
            'american beech',
            'white oak', 'red oak',
        ],
    },
    {
        id: 'hedgehog',
        label: 'Hedgehog',
        icon: '🦔',
        description: 'Mixed conifer-hardwood forests — spruce, fir, pine, hemlock, oak, beech',
        match: [
            'engelmann spruce', 'sitka spruce', 'red spruce',
            'subalpine fir', 'grand fir', 'douglas-fir', 'douglas fir',
            'lodgepole pine', 'ponderosa pine', 'eastern white pine',
            'western hemlock', 'eastern hemlock',
            'white oak', 'red oak', 'chestnut oak',
            'american beech',
        ],
    },
    {
        id: 'yellowfoot',
        label: 'Yellowfoot',
        icon: '🌿',
        description: 'Pacific coast conifers on mossy debris — Sitka spruce, western hemlock, Douglas-fir, red alder',
        match: [
            'sitka spruce', 'engelmann spruce',
            'western hemlock',
            'douglas-fir', 'douglas fir',
            'red alder',    // riparian PNW, common co-occurring
        ],
    },
    {
        id: 'black-trumpet',
        label: 'Black Trumpet',
        icon: '🎺',
        description: 'Oak and beech in the East; Douglas-fir and tanoak in the West',
        match: [
            // Eastern
            'white oak', 'red oak', 'black oak', 'chestnut oak',
            'american beech',
            // Western
            'douglas-fir', 'douglas fir',
            'tanoak', 'tan oak',
        ],
    },
    {
        id: 'lions-mane',
        label: "Lion's Mane",
        icon: '🦁',
        description: 'Wounds and dead wood on hardwoods — oak, beech, maple, walnut, elm. No conifers.',
        match: [
            'white oak', 'red oak', 'black oak', 'bur oak',
            'american beech',
            'sugar maple', 'red maple', 'bigleaf maple',
            'black walnut',
            'american elm', 'slippery elm',
        ],
    },
    {
        id: 'chicken-woods',
        label: 'Chicken of the Woods',
        icon: '🐔',
        description: 'Oak strongly preferred; also cherry, black locust, willow',
        match: [
            'white oak', 'red oak', 'black oak', 'bur oak',
            'chestnut oak', 'scarlet oak',
            'black cherry',
            'black locust',
            'black willow', 'peachleaf willow',
        ],
    },
    {
        id: 'maitake',
        label: 'Hen of the Woods',
        icon: '🌳',
        description: 'Old-growth oak at the base, almost exclusively. Occasional beech and maple.',
        match: [
            // Oak is the overwhelming primary host
            'white oak', 'red oak', 'bur oak', 'chestnut oak',
            'black oak', 'scarlet oak',
            'american beech',
            'sugar maple',
        ],
    },
    {
        id: 'candy-cap',
        label: 'Candy Cap',
        icon: '🍬',
        description: 'California and PNW only — live oak, tanoak, madrone, Douglas-fir',
        match: [
            'tanoak', 'tan oak',
            'interior live oak', 'coast live oak', 'canyon live oak',
            'pacific madrone',
            'douglas-fir', 'douglas fir',
        ],
    },
];

// -----------------------------------------------------------------------------
// Resolve a collection to a Set of "region:code" keys using the loaded catalog.
// -----------------------------------------------------------------------------
function resolveCollection(collection, catalog) {
    const keys = new Set();
    for (const row of catalog) {
        const nameLower = row.name.toLowerCase();
        for (const fragment of collection.match) {
            if (nameLower.includes(fragment)) {
                keys.add(`${row.region}:${row.code}`);
                break; // one fragment match per row is sufficient
            }
        }
    }
    return keys;
}

// Return the Set of collection IDs whose resolved keys are fully contained
// in the current working set (i.e. the collection is "active").
function getActiveCollectionIds(catalog, working) {
    const active = new Set();
    for (const col of MUSHROOM_COLLECTIONS) {
        const keys = resolveCollection(col, catalog);
        if (keys.size > 0 && [...keys].every(k => working.has(k))) {
            active.add(col.id);
        }
    }
    return active;
}

// =============================================================================
// Catalog loader
// =============================================================================

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

// =============================================================================
// Render helpers
// =============================================================================

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

    container.innerHTML = filtered.map(r => renderRow(r, selected)).join('');
}

function renderCollectionPills(pillsEl, activeIds) {
    pillsEl.innerHTML = MUSHROOM_COLLECTIONS.map(col => {
        const isActive = activeIds.has(col.id);
        return `<button type="button"
                    class="btn btn-sm me-1 mb-1 collection-chip ${isActive ? 'btn-success' : 'btn-outline-secondary'}"
                    data-collection-id="${escapeHtml(col.id)}"
                    title="${escapeHtml(col.description)}"
                    style="font-size:0.78rem;">
                ${col.icon} ${escapeHtml(col.label)}
            </button>`;
    }).join('');
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

// =============================================================================
// Main init
// =============================================================================

export async function initSpeciesPicker() {
    updateCountBadges(state.treeSpeciesSelection.size);

    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="open-species-picker"]');
        if (!btn) return;
        e.preventDefault();
        openModal();
    });

    async function openModal() {
        const modalEl = document.getElementById('speciesPickerModal');
        if (!modalEl) return;

        // On mobile, the picker button lives inside the layers offcanvas. If
        // that's open, hide it first — a modal-inside-offcanvas positions
        // wrong on iOS Safari and the backdrops fight each other.
        const layersSheet = document.getElementById('layersSheet');
        const offcanvas = layersSheet ? bootstrap.Offcanvas.getInstance(layersSheet) : null;
        if (offcanvas && layersSheet.classList.contains('show')) {
            offcanvas.hide();
            await new Promise(resolve => {
                layersSheet.addEventListener('hidden.bs.offcanvas', resolve, { once: true });
            });
        }

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();

        const listEl    = document.getElementById('speciesPickerList');
        const searchEl  = document.getElementById('speciesPickerSearch');
        const countEl   = document.getElementById('speciesPickerSelectedCount');
        const pillsEl   = document.getElementById('speciesCollectionPills');

        listEl.innerHTML = '<div class="p-3 text-muted small">Loading…</div>';
        if (pillsEl) pillsEl.innerHTML = '<div class="p-1 text-muted small" style="font-size:0.78rem;">Loading…</div>';

        const catalog = await loadCatalog();

        // Working copy of selection — only committed on Done
        const working = new Set(state.treeSpeciesSelection);

        // -------------------------------------------------------------------
        // Helpers that keep pills + count in sync with `working`
        // -------------------------------------------------------------------

        const updateCount = () => {
            countEl.textContent = working.size
                ? `${working.size} selected`
                : 'None selected';
        };

        const refreshPills = () => {
            if (!pillsEl) return;
            renderCollectionPills(pillsEl, getActiveCollectionIds(catalog, working));
        };

        updateCount();
        renderList(listEl, catalog, searchEl.value || '', working);
        refreshPills();

        // -------------------------------------------------------------------
        // Search filter
        // -------------------------------------------------------------------
        searchEl.oninput = () => {
            renderList(listEl, catalog, searchEl.value || '', working);
        };

        // -------------------------------------------------------------------
        // Species row toggle (event delegation)
        // -------------------------------------------------------------------
        listEl.onclick = (e) => {
            const label = e.target.closest('.species-row');
            if (!label) return;
            const key = label.dataset.key;
            if (!key) return;

            const cb = label.querySelector('input[type="checkbox"]');
            if (e.target !== cb) cb.checked = !cb.checked;
            if (cb.checked) working.add(key); else working.delete(key);

            updateCount();
            refreshPills(); // active state may change as user tweaks individual rows
        };

        // -------------------------------------------------------------------
        // Collection pill toggle (event delegation)
        //
        // Toggle semantics:
        //   Active  → remove all keys that aren't also in another active collection
        //   Inactive → add all keys for this collection
        //
        // This means two active collections that share tree species (e.g.
        // chanterelle + porcini both include spruce) will keep those shared
        // species in the working set when one collection is deactivated.
        // -------------------------------------------------------------------
        if (pillsEl) {
            pillsEl.onclick = (e) => {
                const chip = e.target.closest('.collection-chip');
                if (!chip) return;
                const colId = chip.dataset.collectionId;
                const col = MUSHROOM_COLLECTIONS.find(c => c.id === colId);
                if (!col) return;

                const keys = resolveCollection(col, catalog);
                const activeIds = getActiveCollectionIds(catalog, working);

                if (activeIds.has(colId)) {
                    // Deactivate — but only remove keys not covered by other
                    // currently-active collections
                    const otherActiveKeys = new Set();
                    for (const otherId of activeIds) {
                        if (otherId === colId) continue;
                        const otherCol = MUSHROOM_COLLECTIONS.find(c => c.id === otherId);
                        if (otherCol) {
                            for (const k of resolveCollection(otherCol, catalog)) {
                                otherActiveKeys.add(k);
                            }
                        }
                    }
                    for (const k of keys) {
                        if (!otherActiveKeys.has(k)) working.delete(k);
                    }
                } else {
                    // Activate — add all keys for this collection
                    for (const k of keys) working.add(k);
                }

                updateCount();
                refreshPills();
                renderList(listEl, catalog, searchEl.value || '', working);
            };
        }

        // -------------------------------------------------------------------
        // Clear all
        // -------------------------------------------------------------------
        document.getElementById('speciesPickerClear').onclick = () => {
            working.clear();
            renderList(listEl, catalog, searchEl.value || '', working);
            refreshPills();
            updateCount();
        };

        // -------------------------------------------------------------------
        // Done — commit working set to state and reload tiles
        // -------------------------------------------------------------------
        document.getElementById('speciesPickerDone').onclick = () => {
            state.treeSpeciesSelection = working;
            saveTreeSpeciesSelection(working);
            updateCountBadges(working.size);
            reloadSpeciesFilterSources();
            modal.hide();
        };
    }
}