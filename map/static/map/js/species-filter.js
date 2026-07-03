// =============================================================================
// speciesfilter:// MapLibre protocol
// -----------------------------------------------------------------------------
// Custom protocol that composites a display tile with its parallel data tile
// on the fly, setting alpha=0 for any pixel whose FORTYPCD/EVT code is NOT in
// the current selection. When the selection is empty, returns the display tile
// unmodified (fast path — no pixel walk, no data tile fetch).
//
// URL format:  speciesfilter://<region>/{z}/{x}/{y}
// e.g.         speciesfilter://conus/10/163/395
//
// Reads state.treeSpeciesSelection at fetch time. Callers must bump a
// cache-buster on the source URL when the selection changes (setTiles).
// =============================================================================

import { state } from './state.js';
import { getRegionByName } from './map-setup.js';

const TILE_SIZE = 256;

// Small in-memory cache for decoded ImageData, keyed by pmtiles instance + zxy.
// Separate from the hover-lookup caches in map-setup.js because those grow
// unboundedly on hover; this one is bounded here.
const _displayCache = new Map();
const _dataCache = new Map();
const MAX_CACHE = 400;

function cacheKey(pmtilesInst, z, x, y) {
    // pmtilesInst is an object; use its source URL as the key part
    return `${pmtilesInst.source.getKey()}::${z}/${x}/${y}`;
}

async function fetchPngAsImageData(pmtilesInst, cache, z, x, y) {
    const key = cacheKey(pmtilesInst, z, x, y);
    if (cache.has(key)) return cache.get(key);

    let result;
    try {
        result = await pmtilesInst.getZxy(z, x, y);
    } catch {
        return null;
    }
    if (!result) return null;

    const blob = new Blob([result.data], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = TILE_SIZE;
        c.height = TILE_SIZE;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);

        if (cache.size >= MAX_CACHE) {
            const first = cache.keys().next().value;
            cache.delete(first);
        }
        cache.set(key, imgData);
        return imgData;
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Returns { data: Uint8Array } (PNG bytes) — MapLibre's expected shape
async function imageDataToPngBytes(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width;
    c.height = imageData.height;
    const ctx = c.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
}

// Parse "speciesfilter://<region>/{z}/{x}/{y}" and strip query string.
function parseUrl(url) {
    const withoutScheme = url.replace(/^speciesfilter:\/\//, '').split('?')[0];
    const parts = withoutScheme.split('/');
    if (parts.length !== 4) return null;
    const [regionName, z, x, y] = parts;
    return {
        regionName,
        z: parseInt(z, 10),
        x: parseInt(x, 10),
        y: parseInt(y, 10),
    };
}

// Build the Set of selected codes for a given region, as numbers for fast lookup.
function selectedCodesForRegion(regionName) {
    const out = new Set();
    for (const key of state.treeSpeciesSelection) {
        const idx = key.indexOf(':');
        if (idx === -1) continue;
        if (key.slice(0, idx) !== regionName) continue;
        const code = parseInt(key.slice(idx + 1), 10);
        if (Number.isFinite(code)) out.add(code);
    }
    return out;
}

// Passthrough: fetch display PNG bytes and return unmodified.
async function passthrough(pmtilesInst, z, x, y) {
    let result;
    try {
        result = await pmtilesInst.getZxy(z, x, y);
    } catch {
        return null;
    }
    if (!result) return null;
    return new Uint8Array(result.data);
}

// Composite: keep pixels whose data-tile code is in the selection set.
async function filterAndComposite(displayPmtiles, dataPmtiles, selected, z, x, y) {
    const [displayImg, dataImg] = await Promise.all([
        fetchPngAsImageData(displayPmtiles, _displayCache, z, x, y),
        fetchPngAsImageData(dataPmtiles, _dataCache, z, x, y),
    ]);
    if (!displayImg) return null;

    // No data tile at this z/x/y — the display tile shouldn't be shown when
    // filtering is active, because we can't verify pixel codes. Return a
    // fully-transparent tile.
    if (!dataImg) {
        const empty = new ImageData(TILE_SIZE, TILE_SIZE);
        return imageDataToPngBytes(empty);
    }

    // Copy so we don't mutate the cached ImageData.
    const out = new ImageData(
        new Uint8ClampedArray(displayImg.data),
        TILE_SIZE,
        TILE_SIZE
    );

    const dPix = dataImg.data;
    const oPix = out.data;
    const n = TILE_SIZE * TILE_SIZE;

    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        // FORTYPCD/EVT code = R high byte + G low byte (matches lookup in map-setup.js)
        const code = (dPix[idx] << 8) | dPix[idx + 1];
        if (code === 0 || !selected.has(code)) {
            oPix[idx + 3] = 0;
        }
    }

    return imageDataToPngBytes(out);
}

// Main protocol handler. MapLibre calls this for every speciesfilter:// tile.
async function speciesFilterProtocol(params, abortController) {
    const parsed = parseUrl(params.url);
    if (!parsed) return { data: null };

    const region = getRegionByName(parsed.regionName);
    if (!region) return { data: null };

    const pm = await import('./map-setup.js').then(m =>
        m.getRegionPmtilesForFilter(region)
    );
    if (!pm || !pm.display) return { data: null };

    const selected = selectedCodesForRegion(parsed.regionName);

    // Empty selection: passthrough — full display tile, no compositing.
    if (selected.size === 0) {
        const bytes = await passthrough(pm.display, parsed.z, parsed.x, parsed.y);
        return bytes ? { data: bytes } : { data: null };
    }

    // With a selection, we need the data tile to know which pixels to keep.
    if (!pm.data) {
        // No data PMTiles available for this region yet — show nothing rather
        // than misleading unfiltered pixels.
        const empty = new ImageData(TILE_SIZE, TILE_SIZE);
        const bytes = await imageDataToPngBytes(empty);
        return { data: bytes };
    }

    const bytes = await filterAndComposite(
        pm.display, pm.data, selected, parsed.z, parsed.x, parsed.y
    );
    return bytes ? { data: bytes } : { data: null };
}

let _registered = false;

export function registerSpeciesFilterProtocol() {
    if (_registered) return;
    maplibregl.addProtocol('speciesfilter', speciesFilterProtocol);
    _registered = true;
}