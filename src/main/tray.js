'use strict';

const { Tray, Menu, nativeImage, app, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');

let tray = null;
let mainWindow = null;
let currentUnreadCount = 0;
// Track whether the app is quitting so tray click doesn't fight quit sequence.
let isQuitting = false;

// Prefer the multi-resolution .ico (crisp at Windows tray sizes); fall back to
// a PNG if the .ico hasn't been generated yet.
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const ICO_PATH = path.join(ASSETS_DIR, 'icon.ico');
const PNG_FALLBACK = path.join(ASSETS_DIR, 'icons', '32.png');

function getIcon() {
    try {
        const fromIco = nativeImage.createFromPath(ICO_PATH);
        if (!fromIco.isEmpty()) return fromIco;
        const fromPng = nativeImage.createFromPath(PNG_FALLBACK);
        if (!fromPng.isEmpty()) return fromPng;
        log.warn('Tray icon not found — using empty image');
        return nativeImage.createEmpty();
    } catch (err) {
        log.warn('Tray icon load failed — using empty image:', err);
        return nativeImage.createEmpty();
    }
}

function buildContextMenu() {
    return Menu.buildFromTemplate([
        {
            label: 'Open Messages',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
}

function updateTooltip() {
    if (!tray) return;
    const label = currentUnreadCount > 0
        ? `Messages (${currentUnreadCount} unread)`
        : 'Messages';
    tray.setToolTip(label);
}

/**
 * Create and configure the system tray icon.
 * @param {BrowserWindow} win  The main application window.
 * @param {object} opts
 * @param {function} opts.onQuit  Called when user selects Quit from tray.
 */
function createTray(win, { onQuit }) {
    mainWindow = win;

    tray = new Tray(getIcon());
    tray.setToolTip('Messages');
    // On Windows, right-click shows this context menu.
    tray.setContextMenu(buildContextMenu());

    // Single left-click toggles window visibility.
    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Listen for badge update events from IPC.
    ipcMain.on('badge:update', (event, count) => {
        currentUnreadCount = typeof count === 'number' ? count : 0;
        updateTooltip();

        // The unread count is surfaced via the tray tooltip. Windows does not
        // support app.setBadgeCount, so the tooltip is the primary indicator.
    });

    return tray;
}

function isAppQuitting() {
    return isQuitting;
}

function setQuitting(val) {
    isQuitting = val;
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

module.exports = { createTray, isAppQuitting, setQuitting, destroyTray };
