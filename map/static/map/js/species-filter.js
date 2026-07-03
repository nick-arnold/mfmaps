// =============================================================================
// speciesfilter:// MapLibre protocol
// -----------------------------------------------------------------------------
// Renders tree species tiles directly from the data PMTiles. Each pixel's
// FORTYPCD/EVT code is decoded from (R << 8 | G), looked up in the region's
// legend for its hex color, and emitted as RGBA. When state.treeSpeciesSelection
// has entries for this region, only selected codes render; everything else is
// transparent. Empty selection = render all codes.
//
// URL format:  speciesfilter://<region>/{z}/{x}/{y}
// =============================================================================

import { state } from './state.js';
import { getRegionByName, getRegionPmtilesForFilter } from './map-setup.js';

const TILE_SIZE = 256;
const _dataCache = new Map();
const MAX_CACHE = 400;

function cacheKey(pmtilesInst, z, x, y) {
    return `${pmtilesInst.source.getKey()}::${z}/${x}/${y}`;
}

async function fetchDataTile(pmtilesInst, z, x, y) {
    const key = cacheKey(pmtilesInst, z, x, y);
    if (_dataCache.has(key)) return _dataCache.get(key);

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

        if (_dataCache.size >= MAX_CACHE) {
            const first = _dataCache.keys().next().value;
            _dataCache.delete(first);
        }
        _dataCache.set(key, imgData);
        return imgData;
    } finally {
        URL.revokeObjectURL(url);
    }
}

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

// Convert #rrggbb hex to [r, g, b]. Cached because the same hex strings
// recur across many pixels in the same tile.
const _hexCache = new Map();
function hexToRgb(hex) {
    if (_hexCache.has(hex)) return _hexCache.get(hex);
    let r = 0, g = 0, b = 0;
    if (typeof hex === 'string' && hex.startsWith('#') && hex.length === 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }
    const rgb = [r, g, b];
    _hexCache.set(hex, rgb);
    return rgb;
}

async function renderTile(region, z, x, y) {
    const pm = getRegionPmtilesForFilter(region);
    if (!pm || !pm.data) return null;

    const dataImg = await fetchDataTile(pm.data, z, x, y);
    if (!dataImg) return null;

    const legend = state.treeSpeciesLegends[region.name];
    if (!legend) return null;

    const selected = selectedCodesForRegion(region.name);
    const hasFilter = selected.size > 0;

    const out = new ImageData(TILE_SIZE, TILE_SIZE);
    const dPix = dataImg.data;
    const oPix = out.data;
    const n = TILE_SIZE * TILE_SIZE;

    // Per-tile lookup cache: code → [r,g,b,a] so we don't repeat the legend
    // Map lookup and hex parse for every pixel of the same species.
    const codeCache = new Map();

    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        const code = (dPix[idx] << 8) | dPix[idx + 1];
        if (code === 0) continue; // alpha already 0 in fresh ImageData

        let rgba = codeCache.get(code);
        if (rgba === undefined) {
            if (hasFilter && !selected.has(code)) {
                rgba = null;
            } else {
                const info = legend.get(code);
                if (!info) {
                    rgba = null;
                } else {
                    const [r, g, b] = hexToRgb(info.hex);
                    rgba = [r, g, b, 255];
                }
            }
            codeCache.set(code, rgba);
        }

        if (rgba === null) continue;
        oPix[idx]     = rgba[0];
        oPix[idx + 1] = rgba[1];
        oPix[idx + 2] = rgba[2];
        oPix[idx + 3] = rgba[3];
    }

    return imageDataToPngBytes(out);
}

async function speciesFilterProtocol(params) {
    const parsed = parseUrl(params.url);
    if (!parsed) return { data: null };

    const region = getRegionByName(parsed.regionName);
    if (!region) return { data: null };

    const bytes = await renderTile(region, parsed.z, parsed.x, parsed.y);
    return bytes ? { data: bytes } : { data: null };
}

let _registered = false;

export function registerSpeciesFilterProtocol() {
    if (_registered) return;
    maplibregl.addProtocol('speciesfilter', speciesFilterProtocol);
    _registered = true;
}