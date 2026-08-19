// =============================================================================
// attrfilter:// MapLibre protocol
// -----------------------------------------------------------------------------
// Renders TreeMap attribute layers (STDSZCD / STANDHT / QMD) directly from
// their data PMTiles. Each pixel's raw value is decoded from (R << 8 | G),
// divided by the layer's scale factor, matched to a legend class bracket, and
// emitted as RGBA.
//
// When state.attrFilters[attr] is set to {min, max}, only pixels whose decoded
// value falls in that range render; everything else is transparent. No filter
// set = render all values.
//
// URL format:  attrfilter://<attr>/{z}/{x}/{y}
// =============================================================================

import { state } from './state.js';

const TILE_SIZE = 256;
const MAX_CACHE = 400;
const BASE = 'https://mfmaps-tiles.sfo3.cdn.digitaloceanspaces.com/tree-attrs';

export const ATTR_LAYERS = [
    {
        name: 'stdszcd',
        title: 'Stand size class',
        dataPmtilesUrl: `${BASE}/treemap_stdszcd_conus_data_v1.pmtiles`,
        legendUrl:      `${BASE}/treemap_stdszcd_conus_legend.json`,
        kind: 'categorical',
        scale: 1,
        unit: '',
        bbox: [-125.5, 24.0, -66.0, 50.0],
        maxZoom: 13,
        opacity: 0.35,
    },
    {
        name: 'standht',
        title: 'Stand height',
        dataPmtilesUrl: `${BASE}/treemap_standht_conus_data_v1.pmtiles`,
        legendUrl:      `${BASE}/treemap_standht_conus_legend.json`,
        kind: 'binned',
        scale: 1,
        unit: 'ft',
        bbox: [-125.5, 24.0, -66.0, 50.0],
        maxZoom: 13,
        opacity: 0.35,
    },
    {
        name: 'qmd',
        title: 'Quadratic mean diameter',
        dataPmtilesUrl: `${BASE}/treemap_qmd_conus_data_v1.pmtiles`,
        legendUrl:      `${BASE}/treemap_qmd_conus_legend.json`,
        kind: 'binned',
        scale: 100,
        unit: 'in',
        bbox: [-125.5, 24.0, -66.0, 50.0],
        maxZoom: 13,
        opacity: 0.35,
    },
];

const _layerState = new Map();
const _dataCache = new Map();

export function getAttrLayers() {
    return ATTR_LAYERS;
}

export function getAttrByName(name) {
    return ATTR_LAYERS.find(a => a.name === name) || null;
}

function getLayerState(layer) {
    if (_layerState.has(layer.name)) return _layerState.get(layer.name);
    const s = {
        dataPmtiles: new pmtiles.PMTiles(layer.dataPmtilesUrl),
        classes: null,       // ordered [{min, max, hex, label, rgb}]
        legendLoaded: false,
    };
    _layerState.set(layer.name, s);
    return s;
}

export function getAttrPmtiles(layer) {
    return getLayerState(layer).dataPmtiles;
}

// -----------------------------------------------------------------------------
// Legend loading
// -----------------------------------------------------------------------------

export async function preloadAttrLegends() {
    await Promise.all(ATTR_LAYERS.map(async (layer) => {
        const s = getLayerState(layer);
        try {
            const resp = await fetch(layer.legendUrl);
            const raw = await resp.json();
            s.classes = (raw.classes || []).map(c => ({
                min:   c.min ?? null,
                max:   c.max ?? null,
                code:  c.code ?? null,
                hex:   c.hex,
                label: c.label,
                rgb:   c.rgb || hexToRgb(c.hex),
            }));
            s.legendLoaded = true;
            state.attrLegends[layer.name] = s.classes;
        } catch (err) {
            console.warn(`Attr legend preload failed for ${layer.name}:`, err);
            s.classes = [];
            s.legendLoaded = true;
            state.attrLegends[layer.name] = [];
        }
    }));
}

// -----------------------------------------------------------------------------
// Value -> class lookup
// -----------------------------------------------------------------------------

function classForValue(layer, classes, value) {
    if (layer.kind === 'categorical') {
        for (let i = 0; i < classes.length; i++) {
            if (classes[i].code === value) return classes[i];
        }
        return null;
    }
    for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        if ((c.min === null || value >= c.min) &&
            (c.max === null || value <  c.max)) return c;
    }
    return null;
}

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

// -----------------------------------------------------------------------------
// Tile fetch + decode
// -----------------------------------------------------------------------------

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

    // Tiles are lossless WebP; browsers sniff by content, not MIME type.
    const blob = new Blob([result.data], { type: 'image/webp' });
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
        const ctx = c.getContext('2d', { willReadFrequently: true });
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
    const withoutScheme = url.replace(/^attrfilter:\/\//, '').split('?')[0];
    const parts = withoutScheme.split('/');
    if (parts.length !== 4) return null;
    const [attrName, z, x, y] = parts;
    return { attrName, z: parseInt(z, 10), x: parseInt(x, 10), y: parseInt(y, 10) };
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

async function renderTile(layer, z, x, y) {
    const s = getLayerState(layer);
    if (!s.dataPmtiles) return null;

    const dataImg = await fetchDataTile(s.dataPmtiles, z, x, y);
    if (!dataImg) return null;

    const classes = s.classes;
    if (!classes || !classes.length) return null;

    const filter = state.attrFilters?.[layer.name] || null;
    const fMin = filter && Number.isFinite(filter.min) ? filter.min : null;
    const fMax = filter && Number.isFinite(filter.max) ? filter.max : null;
    const hasFilter = fMin !== null || fMax !== null;

    const out = new ImageData(TILE_SIZE, TILE_SIZE);
    const dPix = dataImg.data;
    const oPix = out.data;
    const n = TILE_SIZE * TILE_SIZE;
    const scale = layer.scale;

    // Per-tile cache: raw encoded value -> [r,g,b,a] or null.
    const rawCache = new Map();

    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        if (dPix[idx + 3] === 0) continue;         // no data
        const raw = (dPix[idx] << 8) | dPix[idx + 1];
        if (raw === 0) continue;

        let rgba = rawCache.get(raw);
        if (rgba === undefined) {
            const value = raw / scale;
            if (hasFilter &&
                ((fMin !== null && value < fMin) || (fMax !== null && value > fMax))) {
                rgba = null;
            } else {
                const cls = classForValue(layer, classes, value);
                rgba = cls ? [cls.rgb[0], cls.rgb[1], cls.rgb[2], 255] : null;
            }
            rawCache.set(raw, rgba);
        }

        if (rgba === null) continue;
        oPix[idx]     = rgba[0];
        oPix[idx + 1] = rgba[1];
        oPix[idx + 2] = rgba[2];
        oPix[idx + 3] = rgba[3];
    }

    return imageDataToPngBytes(out);
}

async function attrFilterProtocol(params) {
    const parsed = parseUrl(params.url);
    if (!parsed) return { data: null };

    const layer = getAttrByName(parsed.attrName);
    if (!layer) return { data: null };

    const bytes = await renderTile(layer, parsed.z, parsed.x, parsed.y);
    return bytes ? { data: bytes } : { data: null };
}

let _registered = false;

export function registerAttrFilterProtocol() {
    if (_registered) return;
    maplibregl.addProtocol('attrfilter', attrFilterProtocol);
    _registered = true;
}

// Force MapLibre to re-request tiles after a filter change.
export function reloadAttrSources(attrName) {
    const map = state.map;
    if (!map) return;
    const stamp = Date.now();
    const targets = attrName ? [attrName] : ATTR_LAYERS.map(a => a.name);
    targets.forEach(name => {
        const src = map.getSource(`attr-${name}`);
        if (!src) return;
        src.setTiles([`attrfilter://${name}/{z}/{x}/{y}?v=${stamp}`]);
    });
}

// Resolve PMTiles headers ahead of first tile request.
export async function warmAttrArchives() {
    await Promise.all(ATTR_LAYERS.map(async (layer) => {
        try {
            await getLayerState(layer).dataPmtiles.getHeader();
        } catch (err) {
            console.warn(`Attr archive warm failed for ${layer.name}:`, err);
        }
    }));
}

// Decode a single pixel's value at a lat/lng — for hover/pick readout.
export async function valueAtTile(layer, z, x, y, px, py) {
    const s = getLayerState(layer);
    const img = await fetchDataTile(s.dataPmtiles, z, x, y);
    if (!img) return null;
    const idx = (py * TILE_SIZE + px) * 4;
    if (img.data[idx + 3] === 0) return null;
    const raw = (img.data[idx] << 8) | img.data[idx + 1];
    if (raw === 0) return null;
    return raw / layer.scale;
}
