// =============================================================================
// shade:// MapLibre protocol
// -----------------------------------------------------------------------------
// Colorizes baked grayscale hillshade tiles at render time. Each pixel's gray
// value (0 = deepest shadow, 255 = flat) is mapped through SHADE_LUT to the
// shadow color plus an alpha, so flat ground drops out entirely and only
// shading paints. Keeping the alpha out of the tile lets WebP compress the
// grayscale lossily -- ~26 kB/tile vs ~187 kB with a baked alpha channel.
//
// URL format:  shade://<pmtiles-url>#{z}/{x}/{y}
// =============================================================================


const TILE_SIZE = 512;
const SHADOW_RGB = [58, 42, 24];        // #3a2a18

// gray value -> alpha. Breakpoints from the z3 histogram: p5=123, p25=185,
// median=220, flat=255. Interpolated linearly between stops.
const ALPHA_STOPS = [
    [0, 255], [140, 230], [190, 180], [215, 120], [235, 60], [248, 20], [255, 0]
];

const SHADE_LUT = (() => {
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
        let i = 0;
        while (i < ALPHA_STOPS.length - 2 && ALPHA_STOPS[i + 1][0] < v) i++;
        const [v0, a0] = ALPHA_STOPS[i];
        const [v1, a1] = ALPHA_STOPS[i + 1];
        const t = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
        lut[v] = Math.round(a0 + (a1 - a0) * t);
    }
    return lut;
})();

const _instances = new Map();

function instanceFor(url) {
    if (!_instances.has(url)) _instances.set(url, new pmtiles.PMTiles(url));
    return _instances.get(url);
}

async function blankTile() {
    const c = document.createElement('canvas');
    c.width = c.height = TILE_SIZE;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return { data: await blob.arrayBuffer() };
}

export function registerShadeProtocol() {
    maplibregl.addProtocol('shade', async (params, _abort) => {
        const m = params.url.match(/^shade:\/\/(.+)#(\d+)\/(\d+)\/(\d+)$/);
        if (!m) throw new Error('Bad shade URL: ' + params.url);
        const [, archive, z, x, y] = m;

        let result;
        try {
            result = await instanceFor(archive).getZxy(+z, +x, +y);
        } catch {
            return blankTile();
        }
        if (!result) return blankTile();

        const blob = new Blob([result.data], { type: 'image/webp' });
        const bitmap = await createImageBitmap(blob);

        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            // Tiles now carry a nodata mask in A. Multiply the shading alpha
            // by it so nodata stays fully transparent instead of painting
            // shadow over empty ground.
            const mask = d[i + 3];
            const a = SHADE_LUT[d[i]];      // R channel; gray so R==G==B
            d[i] = SHADOW_RGB[0];
            d[i + 1] = SHADOW_RGB[1];
            d[i + 2] = SHADOW_RGB[2];
            d[i + 3] = (a * mask) / 255;
        }
        ctx.putImageData(img, 0, 0);

        const out = await new Promise(r => c.toBlob(r, 'image/png'));
        return { data: await out.arrayBuffer() };
    });
}