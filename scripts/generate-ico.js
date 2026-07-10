#!/usr/bin/env node
/**
 * generate-ico.js
 *
 * Packs the PNG icons in assets/icons/ into a single multi-resolution Windows
 * .ico file. Pure Node, no external tools (ImageMagick / Inkscape) required —
 * works out of the box on Windows on ARM.
 *
 * Frame format matters here: Windows officially supports PNG-compressed icon
 * frames at any size since Vista, but Explorer's desktop/taskbar icon
 * extraction path (used for shortcut icons, not just the raw exe resource) is
 * stricter than that and falls back to a generic "broken icon" glyph for
 * PNG-compressed frames below 256px. The de facto convention every icon tool
 * follows — and the one used here — is classic uncompressed BMP/DIB frames
 * for every size below 256, with PNG reserved for the 256px frame only.
 *
 * Output:
 *   build/icon.ico   — used by electron-builder for the exe / installer icon
 *   assets/icon.ico  — shipped inside the app for the window + tray icon
 *
 * Usage: node scripts/generate-ico.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'assets', 'icons');

// Sizes to embed. 256 is stored last and flagged as 0x0 per the ICO spec.
const SIZES = [16, 32, 48, 64, 128, 256];
// Frames at or above this size are embedded as PNG; below it, as BMP/DIB.
const PNG_THRESHOLD = 256;

function readPng(size) {
    const p = path.join(ICONS_DIR, `${size}.png`);
    if (!fs.existsSync(p)) {
        throw new Error(`Missing source PNG: ${p}`);
    }
    return fs.readFileSync(p);
}

// ─── Minimal PNG decoder ───────────────────────────────────────────────────
// Supports exactly what our own PNGs are: 8-bit, non-interlaced, colorType 6
// (RGBA) or 2 (RGB). That's all System.Drawing / any standard PNG encoder
// produces for our source images, so no general-purpose PNG support is needed.
function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) {
        throw new Error('Not a PNG file (bad signature)');
    }

    let offset = 8;
    let width, height, bitDepth, colorType, interlace;
    const idatChunks = [];

    while (offset < buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        const data = buf.subarray(offset + 8, offset + 8 + len);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idatChunks.push(data);
        } else if (type === 'IEND') {
            break;
        }

        offset += 8 + len + 4; // length + type + data + crc
    }

    if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(
            `Unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}) — ` +
            'expected 8-bit non-interlaced RGB or RGBA'
        );
    }

    const channels = colorType === 6 ? 4 : 3;
    const stride = width * channels;
    const raw = zlib.inflateSync(Buffer.concat(idatChunks));
    const pixels = Buffer.alloc(height * stride);

    let rawOffset = 0;
    for (let y = 0; y < height; y++) {
        const filterType = raw[rawOffset];
        rawOffset += 1;
        const rowStart = y * stride;

        for (let x = 0; x < stride; x++) {
            const raw_x = raw[rawOffset + x];
            const a = x >= channels ? pixels[rowStart + x - channels] : 0;
            const b = y > 0 ? pixels[rowStart - stride + x] : 0;
            const c = (x >= channels && y > 0) ? pixels[rowStart - stride + x - channels] : 0;
            let value;

            switch (filterType) {
                case 0: value = raw_x; break;
                case 1: value = (raw_x + a) & 0xff; break;
                case 2: value = (raw_x + b) & 0xff; break;
                case 3: value = (raw_x + ((a + b) >> 1)) & 0xff; break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
                    value = (raw_x + pred) & 0xff;
                    break;
                }
                default:
                    throw new Error(`Unknown PNG filter type ${filterType}`);
            }
            pixels[rowStart + x] = value;
        }
        rawOffset += stride;
    }

    if (channels === 4) {
        return { width, height, rgba: pixels };
    }

    // RGB -> RGBA (opaque)
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
        rgba[j] = pixels[i];
        rgba[j + 1] = pixels[i + 1];
        rgba[j + 2] = pixels[i + 2];
        rgba[j + 3] = 255;
    }
    return { width, height, rgba };
}

// ─── BMP/DIB icon frame (classic ICO format, used for sizes < 256) ────────
// Layout: 40-byte BITMAPINFOHEADER (biHeight = 2x actual height, since it
// covers both the XOR color image and the AND mask), then the 32bpp BGRA
// color data bottom-up, then a 1bpp AND mask (all zero — full alpha handles
// transparency, the mask is only present because the format requires it).
function pngToBmpFrame(pngBuf) {
    const { width, height, rgba } = decodePng(pngBuf);

    const xorStride = width * 4;
    const xor = Buffer.alloc(xorStride * height);
    for (let y = 0; y < height; y++) {
        const srcRow = height - 1 - y; // dest is bottom-up
        for (let x = 0; x < width; x++) {
            const s = (srcRow * width + x) * 4;
            const d = y * xorStride + x * 4;
            xor[d] = rgba[s + 2];     // B
            xor[d + 1] = rgba[s + 1]; // G
            xor[d + 2] = rgba[s];     // R
            xor[d + 3] = rgba[s + 3]; // A
        }
    }

    const maskStride = Math.ceil(width / 32) * 4; // 1bpp, rows padded to 4 bytes
    const mask = Buffer.alloc(maskStride * height);

    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);          // biSize
    header.writeInt32LE(width, 4);        // biWidth
    header.writeInt32LE(height * 2, 8);   // biHeight (XOR + AND)
    header.writeUInt16LE(1, 12);          // biPlanes
    header.writeUInt16LE(32, 14);         // biBitCount
    header.writeUInt32LE(0, 16);          // biCompression (BI_RGB)
    header.writeUInt32LE(xor.length + mask.length, 20); // biSizeImage
    header.writeInt32LE(0, 24);           // biXPelsPerMeter
    header.writeInt32LE(0, 28);           // biYPelsPerMeter
    header.writeUInt32LE(0, 32);          // biClrUsed
    header.writeUInt32LE(0, 36);          // biClrImportant

    return Buffer.concat([header, xor, mask]);
}

/**
 * Build an ICO buffer from a list of { size, data } entries, where data is
 * either a raw PNG buffer (size >= PNG_THRESHOLD) or a BMP/DIB frame buffer
 * (size < PNG_THRESHOLD) as produced above.
 */
function buildIco(images) {
    const count = images.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: 1 = icon
    header.writeUInt16LE(count, 4);

    const dirEntries = [];
    const blobs = [];
    let offset = 6 + count * 16;

    for (const img of images) {
        const entry = Buffer.alloc(16);
        // Width/height: 0 means 256 per the ICO spec.
        entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
        entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
        entry.writeUInt8(0, 2);  // color palette count
        entry.writeUInt8(0, 3);  // reserved
        entry.writeUInt16LE(1, 4);   // color planes
        entry.writeUInt16LE(32, 6);  // bits per pixel
        entry.writeUInt32LE(img.data.length, 8);  // size of image data
        entry.writeUInt32LE(offset, 12);          // offset of image data
        dirEntries.push(entry);
        blobs.push(img.data);
        offset += img.data.length;
    }

    return Buffer.concat([header, ...dirEntries, ...blobs]);
}

function main() {
    const images = SIZES.map((size) => {
        const pngBuf = readPng(size);
        const data = size >= PNG_THRESHOLD ? pngBuf : pngToBmpFrame(pngBuf);
        return { size, data };
    });
    const ico = buildIco(images);

    const buildDir = path.join(ROOT, 'build');
    fs.mkdirSync(buildDir, { recursive: true });

    const buildIcoPath = path.join(buildDir, 'icon.ico');
    const assetIcoPath = path.join(ROOT, 'assets', 'icon.ico');

    fs.writeFileSync(buildIcoPath, ico);
    fs.writeFileSync(assetIcoPath, ico);

    const kb = (ico.length / 1024).toFixed(1);
    console.log(`Generated icon.ico (${kb} KB, sizes: ${SIZES.join(', ')}; BMP < ${PNG_THRESHOLD}px, PNG >= ${PNG_THRESHOLD}px)`);
    console.log(`  -> ${buildIcoPath}`);
    console.log(`  -> ${assetIcoPath}`);
}

main();
