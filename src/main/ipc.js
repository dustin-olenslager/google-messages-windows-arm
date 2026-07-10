'use strict';

const { ipcMain, app, Notification, shell } = require('electron');
const log = require('electron-log');

// Holds a reference to the main window; set by main.js after window creation.
let mainWindow = null;

function setMainWindow(win) {
    mainWindow = win;
}

function registerHandlers() {
    // --- Notification bridge ---
    // Renderer sends this when a web Notification is intercepted by the preload.
    // On Windows these surface as native toast notifications in the Action Center,
    // attributed to the app via the AppUserModelID set in main.js.
    ipcMain.on('notification:show', (event, { title, body, icon, tag }) => {
        if (!Notification.isSupported()) {
            log.warn('Native notifications not supported on this system');
            return;
        }

        try {
            const notif = new Notification({
                title: title || 'Messages',
                body: body || '',
                // Electron's Notification icon expects a local path or data URL.
                // Google sends HTTPS icon URLs — we skip them to avoid async fetch
                // complexity; Windows falls back to the app's shortcut icon.
                silent: false
            });

            notif.on('click', () => {
                if (mainWindow) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.show();
                    mainWindow.focus();
                }
            });

            notif.show();
        } catch (err) {
            log.error('Failed to show native notification:', err);
        }
    });

    // --- Unread badge count ---
    // Preload sends updated count whenever page title changes.
    ipcMain.on('badge:update', (event, count) => {
        try {
            // setBadgeCount is a no-op on Windows (Linux/macOS only), but harmless.
            // The tray tooltip (tray.js) is the primary unread indicator on Windows.
            if (typeof app.setBadgeCount === 'function') {
                app.setBadgeCount(count);
            }
        } catch (err) {
            log.warn('setBadgeCount failed:', err);
        }
    });

    // --- External URL handler ---
    // Preload forwards URLs that should open in the system browser.
    ipcMain.on('open:external', (event, url) => {
        try {
            const parsed = new URL(url);
            // Only open http/https URLs externally; ignore anything else.
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                shell.openExternal(url).catch((err) => {
                    log.error('shell.openExternal failed:', err);
                });
            }
        } catch (err) {
            log.warn('Invalid URL passed to open:external:', url, err);
        }
    });

    // --- Protocol handler (sms://, tel://) ---
    ipcMain.on('protocol:url', (event, url) => {
        // Focus the window when a protocol URL is triggered.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
        log.info('Protocol URL received:', url);
    });
}

module.exports = { registerHandlers, setMainWindow };
