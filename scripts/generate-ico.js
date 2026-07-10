#!/usr/bin/env node
/**
 * generate-ico.js
 *
 * Packs the PNG icons in assets/icons/ into a single multi-resolution Windows
 * .ico file. Windows .ico containers can embed PNG images directly (Vista+),
 * so no external tools (ImageMagick / Inkscape) are required — this is pure
 * Node and works out of the box on Windows on ARM.
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

const ROOT = path.join(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'assets', 'icons');

// Sizes to embed. 256 is stored last and flagged as 0x0 per the ICO spec.
const SIZES = [16, 32, 48, 64, 128, 256];

function readPng(size) {
    const p = path.join(ICONS_DIR, `${size}.png`);
    if (!fs.existsSync(p)) {
        throw new Error(`Missing source PNG: ${p}`);
    }
    return fs.readFileSync(p);
}

/**
 * Build an ICO buffer from a list of { size, data } PNG entries.
 * ICO layout: 6-byte ICONDIR header, then 16-byte ICONDIRENTRY per image,
 * then the raw image blobs.
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
    const images = SIZES.map((size) => ({ size, data: readPng(size) }));
    const ico = buildIco(images);

    const buildDir = path.join(ROOT, 'build');
    fs.mkdirSync(buildDir, { recursive: true });

    const buildIcoPath = path.join(buildDir, 'icon.ico');
    const assetIcoPath = path.join(ROOT, 'assets', 'icon.ico');

    fs.writeFileSync(buildIcoPath, ico);
    fs.writeFileSync(assetIcoPath, ico);

    const kb = (ico.length / 1024).toFixed(1);
    console.log(`Generated icon.ico (${kb} KB, sizes: ${SIZES.join(', ')})`);
    console.log(`  -> ${buildIcoPath}`);
    console.log(`  -> ${assetIcoPath}`);
}

main();
