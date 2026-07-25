'use strict';

/**
 * main.js — Entry point for the Google Messages Electron app (Windows).
 *
 * Responsibilities:
 *  - App lifecycle (ready, window-all-closed, before-quit, etc.)
 *  - BrowserWindow creation and configuration
 *  - Single instance lock
 *  - Session / UA spoofing
 *  - Navigation security (block non-messages.google.com URLs)
 *  - Window state persistence
 *  - Keyboard shortcuts
 *  - Context menu
 *  - Network offline detection
 *  - Error page fallback
 *  - Wires up tray, menu, IPC, and notifications modules
 *
 * Target: Windows 10/11 on ARM64 (Snapdragon X) and x64.
 */

const {
    app,
    BrowserWindow,
    session,
    ipcMain,
    globalShortcut,
    Menu,
    MenuItem,
    net,
    shell
} = require('electron');

const path = require('path');
const log = require('electron-log');

const store = require('./store');
const { createTray, isAppQuitting, setQuitting, destroyTray } = require('./tray');
const { buildMenu } = require('./menu');
const { registerHandlers, setMainWindow } = require('./ipc');

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_USER_MODEL_ID = 'com.googlemessages.windows';
const MESSAGES_URL = 'https://messages.google.com/web';
const MESSAGES_HOST = 'messages.google.com';

// Hosts the app is allowed to navigate to in-window. Google account sign-in
// (used for pairing without a QR code) redirects through accounts.google.com,
// so it must stay in-window — punting it to the system browser strands the
// flow in a session that can never hand its cookies back to us.
const ALLOWED_HOSTS = [MESSAGES_HOST, 'accounts.google.com'];

// isDev: true when running unpackaged (`electron .`) or with NODE_ENV=development.
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

// Google's sign-in blocks "embedded browsers" ("Couldn't sign you in — this
// browser or app may not be secure"). The trigger is the `Electron/x.y.z`
// token Chromium puts in the UA, so we present a plain Chrome UA instead.
//
// The version is taken from the Chromium we are actually running so the UA can
// never drift out of sync with the engine — a UA claiming a Chrome version that
// does not match the renderer's behaviour is itself a detection signal.
const CHROME_UA =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${process.versions.chrome} Safari/537.36`;

// Must be set before any BrowserWindow or session exists. Unlike a webRequest
// header rewrite, this covers every surface that matters: outgoing headers,
// `navigator.userAgent` as seen by page scripts, subframes and popups.
app.userAgentFallback = CHROME_UA;

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const WINDOW_ICON = path.join(ASSETS_DIR, 'icon.ico');

// Windows requires an explicit AppUserModelID so toast notifications and the
// taskbar group are attributed to this app (not "electron.app.Electron").
// Must be set as early as possible.
app.setAppUserModelId(APP_USER_MODEL_ID);

// ─── Logging setup ────────────────────────────────────────────────────────────
log.initialize();
log.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'logs', 'main.log');
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'warn';

log.info('App starting. Version:', app.getVersion(), 'arch:', process.arch);

// ─── Single instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    log.info('Another instance is running — exiting.');
    app.quit();
    process.exit(0);
}

// ─── Protocol handler registration ────────────────────────────────────────────
// Register sms:// and tel:// so Windows routes these URIs to our app (HKCU,
// no admin required). In development the launcher is electron.exe, so we must
// also pass the script path as an argument.
function registerProtocols() {
    const schemes = ['sms', 'tel'];
    try {
        if (process.defaultApp) {
            if (process.argv.length >= 2) {
                const args = [path.resolve(process.argv[1])];
                for (const scheme of schemes) {
                    app.setAsDefaultProtocolClient(scheme, process.execPath, args);
                }
            }
        } else {
            for (const scheme of schemes) {
                app.setAsDefaultProtocolClient(scheme);
            }
        }
    } catch (err) {
        log.warn('Protocol registration failed:', err);
    }
}
registerProtocols();

// ─── Globals ──────────────────────────────────────────────────────────────────
let mainWindow = null;
let offlineCheckInterval = null;

// ─── Window factory ───────────────────────────────────────────────────────────
function createWindow() {
    const bounds = store.get('windowBounds');
    const isMaximized = store.get('windowMaximized');
    const savedZoom = store.get('zoomFactor');

    mainWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        minWidth: 800,
        minHeight: 600,
        title: 'Messages',
        // Standard Windows title bar / frame — the OS handles decorations and
        // Snap layouts, so we do not go frameless.
        frame: true,
        show: false, // shown after ready-to-show to prevent white flash
        backgroundColor: '#ffffff',
        icon: WINDOW_ICON,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            // Persistent session keeps auth cookies across launches.
            partition: 'persist:messages',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Disable throttling so notifications fire when window is backgrounded.
            backgroundThrottling: false,
            allowRunningInsecureContent: false
        }
    });

    // ── Apply saved zoom ─────────────────────────────────────────────────────
    if (savedZoom && savedZoom !== 1.0) {
        mainWindow.webContents.setZoomFactor(savedZoom);
    }

    // ── Show window (avoiding white flash) ───────────────────────────────────
    mainWindow.once('ready-to-show', () => {
        if (isMaximized) {
            mainWindow.maximize();
        }
        mainWindow.show();
        mainWindow.focus();
    });

    // ── Window state persistence ─────────────────────────────────────────────
    function saveBounds() {
        if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
            store.set('windowBounds', mainWindow.getBounds());
        }
        store.set('windowMaximized', mainWindow.isMaximized());
    }
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
    mainWindow.on('maximize', () => store.set('windowMaximized', true));
    mainWindow.on('unmaximize', () => store.set('windowMaximized', false));

    // ── Close → hide to tray ─────────────────────────────────────────────────
    mainWindow.on('close', (event) => {
        if (!isAppQuitting()) {
            // Prevent default close; hide to tray instead.
            event.preventDefault();
            mainWindow.hide();
            return;
        }
        // App is actually quitting — save state and let it close.
        saveBounds();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        setMainWindow(null);
        if (offlineCheckInterval) {
            clearInterval(offlineCheckInterval);
            offlineCheckInterval = null;
        }
    });

    return mainWindow;
}

// ─── Session configuration ────────────────────────────────────────────────────
function configureSession() {
    const ses = session.fromPartition('persist:messages');
    ses.setUserAgent(CHROME_UA);
    log.info('Session UA:', CHROME_UA);
}

// ─── Navigation security ──────────────────────────────────────────────────────
// Only messages.google.com is allowed within the BrowserWindow.
// All other URLs are opened in the default system browser.
function setupNavigation(win) {
    const wc = win.webContents;

    function isSafeUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
            return ALLOWED_HOSTS.some(
                (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host)
            );
        } catch {
            return false;
        }
    }

    // Block in-app navigation to external sites.
    wc.on('will-navigate', (event, url) => {
        if (!isSafeUrl(url)) {
            event.preventDefault();
            shell.openExternal(url).catch((err) =>
                log.error('External navigation failed:', url, err)
            );
        }
    });

    // New window requests (target=_blank, window.open, etc.)
    wc.setWindowOpenHandler(({ url }) => {
        if (isSafeUrl(url)) {
            // Sign-in opens the account chooser via window.open. We never open a
            // second BrowserWindow, so follow it in the main window instead —
            // denying outright would make the popup silently do nothing.
            wc.loadURL(url).catch((err) => log.error('In-window open failed:', url, err));
        } else {
            shell.openExternal(url).catch((err) =>
                log.error('External window open failed:', url, err)
            );
        }
        return { action: 'deny' };
    });

    // Handle load failures — show error page.
    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        // Ignore aborted loads (e.g. navigation before previous load finished).
        if (errorCode === -3) return;
        log.warn('Page load failed:', errorCode, errorDescription, validatedURL);
        loadErrorPage(win, errorCode, errorDescription);
    });

    // Track page title for unread badge (belt-and-suspenders with preload observer).
    wc.on('page-title-updated', (event, title) => {
        const match = title.match(/^\((\d+)\)/);
        const count = match ? parseInt(match[1], 10) : 0;
        // Badge update is handled in ipc.js / tray.js via the 'badge:update' IPC
        // message from preload. Here we emit directly as a fallback.
        try {
            if (typeof app.setBadgeCount === 'function') {
                app.setBadgeCount(count);
            }
        } catch (err) {
            log.warn('setBadgeCount fallback failed:', err);
        }
    });
}

// ─── Error page ───────────────────────────────────────────────────────────────
function loadErrorPage(win, errorCode, errorDescription) {
    const errorPagePath = path.join(__dirname, '..', 'renderer', 'error.html');
    // Pass error details via query string so error.js can display them.
    const params = new URLSearchParams({
        code: errorCode || '',
        desc: errorDescription || 'Unknown error'
    });
    win.loadFile(errorPagePath, { query: Object.fromEntries(params) }).catch((err) =>
        log.error('Failed to load error page:', err)
    );
}

// ─── Network offline detection ────────────────────────────────────────────────
function startOfflineMonitor(win) {
    let wasOnline = true;

    offlineCheckInterval = setInterval(() => {
        const isOnline = net.isOnline();
        if (isOnline !== wasOnline) {
            wasOnline = isOnline;
            log.info('Network status changed. Online:', isOnline);

            if (!win.isDestroyed()) {
                win.webContents.send('network:status', isOnline);

                if (isOnline) {
                    // Auto-retry: reload if we were showing the error page.
                    const currentURL = win.webContents.getURL();
                    if (currentURL.startsWith('file://')) {
                        log.info('Network restored — reloading Messages');
                        win.loadURL(MESSAGES_URL).catch((err) =>
                            log.error('Reload after network restore failed:', err)
                        );
                    }
                }
            }
        }
    }, 3000);
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function setupContextMenu(win) {
    win.webContents.on('context-menu', (event, params) => {
        const menu = new Menu();

        if (params.isEditable || params.selectionText) {
            if (params.isEditable) {
                menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.selectionText.length > 0 }));
            }
            menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.selectionText.length > 0 }));
            if (params.isEditable) {
                menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
            }
            menu.append(new MenuItem({ type: 'separator' }));
        }

        menu.append(new MenuItem({
            label: 'Reload',
            click: () => win.webContents.reload()
        }));

        if (isDev) {
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({
                label: 'Inspect Element',
                click: () => {
                    win.webContents.inspectElement(params.x, params.y);
                }
            }));
        }

        if (menu.items.length > 0) {
            menu.popup({ window: win });
        }
    });
}

// ─── Global keyboard shortcuts ────────────────────────────────────────────────
function registerShortcuts(win) {
    // F12: DevTools (dev only)
    if (isDev) {
        globalShortcut.register('F12', () => {
            if (win && !win.isDestroyed()) {
                win.webContents.toggleDevTools();
            }
        });
    }
}

// ─── IPC: reload from error page ─────────────────────────────────────────────
ipcMain.on('window:reload', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(MESSAGES_URL).catch((err) =>
            log.error('Manual reload failed:', err)
        );
    }
});

// ─── App events ───────────────────────────────────────────────────────────────
app.on('ready', async () => {
    log.info('App ready');

    // Configure session UA spoofing.
    configureSession();

    // Register IPC handlers.
    registerHandlers();

    // Create the window.
    const win = createWindow();
    setMainWindow(win);

    // Build app menu.
    buildMenu(win);

    // Wire up navigation security.
    setupNavigation(win);

    // Wire up context menu.
    setupContextMenu(win);

    // Register global shortcuts.
    registerShortcuts(win);

    // Create system tray.
    createTray(win, {
        onQuit: () => {
            setQuitting(true);
            app.quit();
        }
    });

    // Start network monitor.
    startOfflineMonitor(win);

    // Load Google Messages.
    win.loadURL(MESSAGES_URL).catch((err) => {
        log.error('Initial load failed:', err);
        loadErrorPage(win, null, err.message);
    });

    // ── TODO: Auto-updater stub ────────────────────────────────────────────
    // When ready to implement: import electron-updater here and call
    // autoUpdater.checkForUpdatesAndNotify(). For now this is intentionally
    // not implemented. NSIS builds are compatible with electron-updater's
    // differential updates when a publish provider is configured.
    // ───────────────────────────────────────────────────────────────────────
});

// Second instance: focus existing window and handle protocol URLs.
// On Windows, sms:// and tel:// URIs arrive here as command-line arguments.
app.on('second-instance', (event, argv) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }

    // Handle protocol URL passed to second instance (sms://, tel://).
    const url = argv.find((arg) => arg.startsWith('sms://') || arg.startsWith('tel://'));
    if (url) {
        log.info('Protocol URL from second instance:', url);
        ipcMain.emit('protocol:url', null, url);
    }
});

// macOS: re-create window when dock icon clicked (not relevant on Windows but harmless).
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        const win = createWindow();
        setMainWindow(win);
        setupNavigation(win);
        setupContextMenu(win);
        win.loadURL(MESSAGES_URL).catch((err) => log.error('Activate reload failed:', err));
    }
});

// 'window-all-closed': on Windows, quit when all windows close.
// Since we hide to tray instead of closing, this fires only on explicit quit.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        destroyTray();
        app.quit();
    }
});

app.on('before-quit', () => {
    setQuitting(true);
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    destroyTray();
    log.info('App will quit');
});

// ─── Unhandled exception logging ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    log.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection:', reason);
});
