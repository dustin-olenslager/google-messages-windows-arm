'use strict';

/**
 * Preload script — runs in an isolated context with access to a limited
 * Node/Electron API surface. contextIsolation: true means this script
 * cannot directly access renderer globals; we use contextBridge to expose
 * only what we need.
 *
 * Responsibilities:
 *  1. Intercept the Web Notification API and forward to main via IPC.
 *  2. Listen for page title changes and send unread badge counts to main.
 *  3. Expose a minimal API for renderer error page interactions.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ─── 0. Chrome identity shim (main world) ────────────────────────────────────
// Google's sign-in refuses any client it classifies as an embedded browser
// ("Couldn't sign you in — this browser or app may not be secure"). Spoofing
// the UA string (see main.js) is not enough: Electron defines `window.chrome`
// but leaves it EMPTY, while real Chrome exposes `app`, `csi` and `loadTimes`
// on it. An empty `window.chrome` is a long-standing "this is Electron" tell,
// and Google's sign-in script reads it directly.
//
// Verified against the live site: submitting an email with the UA spoof alone
// redirects to accounts.google.com/v3/signin/rejected; populating
// `window.chrome` makes the same submission return the normal
// "Couldn't find this account" response. Bisected — client-hint/UA/language
// variations were tested and did not change the outcome.
//
// contextIsolation keeps this script out of the page's world, so the shim is
// evaluated in the main world via webFrame.executeJavaScript — before any page
// script runs (preload executes at document-start).
const chromeIdentityShim = `(() => {
    try {
        if (!window.chrome || Object.keys(window.chrome).length === 0) {
            Object.defineProperty(window, 'chrome', {
                value: {
                    app: {
                        isInstalled: false,
                        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                        getDetails: () => null,
                        getIsInstalled: () => false
                    },
                    csi: () => ({ onloadT: Date.now(), startE: Date.now(), pageT: 1, tran: 15 }),
                    loadTimes: () => ({
                        requestTime: Date.now() / 1000,
                        startLoadTime: Date.now() / 1000,
                        commitLoadTime: Date.now() / 1000,
                        finishDocumentLoadTime: Date.now() / 1000,
                        finishLoadTime: Date.now() / 1000,
                        firstPaintTime: Date.now() / 1000,
                        firstPaintAfterLoadTime: 0,
                        navigationType: 'Other',
                        wasFetchedViaSpdy: true,
                        wasNpnNegotiated: true,
                        npnNegotiatedProtocol: 'h2',
                        wasAlternateProtocolAvailable: false,
                        connectionInfo: 'h2'
                    })
                },
                writable: true,
                configurable: true
            });
        }
    } catch (e) {}
})();`;

try {
    webFrame.executeJavaScript(chromeIdentityShim);
} catch (err) {
    console.warn('[preload] Could not install chrome identity shim:', err);
}

// ─── 1. Intercept Web Notification API ───────────────────────────────────────
// Google Messages uses the browser Notification API. We replace it with a
// shim that sends the notification data to the main process, which creates
// a native Windows toast. This approach keeps nodeIntegration off while still
// getting native notifications.

const OriginalNotification = window.Notification;

class NotificationShim {
    constructor(title, options = {}) {
        // Forward to main process for native notification.
        ipcRenderer.send('notification:show', {
            title,
            body: options.body || '',
            icon: options.icon || '',
            tag: options.tag || ''
        });

        // Simulate the expected Notification properties/events so Google's code
        // doesn't throw when it tries to set onclick etc.
        this.onclick = null;
        this.onclose = null;
        this.onerror = null;
        this.onshow = null;
    }

    close() {
        // No-op — native notifications manage their own lifecycle.
    }

    addEventListener(type, handler) {
        // Minimal stub so Google's code can call addEventListener without errors.
        if (type === 'click') this.onclick = handler;
    }

    removeEventListener() { }
}

// Copy static properties from original (permission, requestPermission, etc.)
NotificationShim.permission = 'granted';
NotificationShim.requestPermission = () => Promise.resolve('granted');

// Replace the global — must happen before page scripts run.
try {
    Object.defineProperty(window, 'Notification', {
        value: NotificationShim,
        writable: false,
        configurable: true
    });
} catch (err) {
    // If definition fails (e.g., CSP restrictions), fall back gracefully.
    console.warn('[preload] Could not replace Notification API:', err);
}

// ─── 2. Title-based unread badge parsing ─────────────────────────────────────
// Google Messages sets the page title to "(N) Messages" when there are unread
// messages. We watch this via MutationObserver on the <title> element.

function extractUnreadCount(title) {
    const match = title.match(/^\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
}

function onTitleChange(title) {
    const count = extractUnreadCount(title);
    ipcRenderer.send('badge:update', count);
}

// Watch for title changes via MutationObserver on <title>.
// document-start timing means <head> may not exist yet; wait for it.
function watchTitle() {
    const titleEl = document.querySelector('title');
    if (!titleEl) {
        // Retry after a tick — preload runs at document-start.
        setTimeout(watchTitle, 100);
        return;
    }

    // Initial read.
    onTitleChange(document.title);

    const observer = new MutationObserver(() => {
        onTitleChange(document.title);
    });

    observer.observe(titleEl, { childList: true });
    // Also observe document.head for dynamic <title> insertion.
    observer.observe(document.head, { childList: true, subtree: false });
}

// We need the DOM to at least have <head>; use DOMContentLoaded if not ready.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchTitle);
} else {
    watchTitle();
}

// ─── 3. contextBridge API ────────────────────────────────────────────────────
// Expose a minimal surface to renderer pages (mainly our error.html).

contextBridge.exposeInMainWorld('electronAPI', {
    // Error page: trigger a hard reload.
    reload: () => ipcRenderer.send('window:reload'),

    // Error page: check if we're online.
    onOnlineStatus: (callback) => {
        ipcRenderer.on('network:status', (event, isOnline) => callback(isOnline));
    }
});
