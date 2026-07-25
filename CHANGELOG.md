# CHANGELOG

All notable changes to this project.

Format: `Added | Changed | Fixed | Removed` — present tense, with commit hash when available.

---

## [1.0.2] — 2026-07-25

### Fixed
- **Google sign-in failed with "Couldn't sign you in — this browser or app may
  not be secure."** Google blocks embedded browsers, and the app was still
  identifying itself as one. Two separate defects caused this:
  - `userAgent` was passed inside `webPreferences`, which is **not** a valid
    Electron option, so it silently did nothing. `navigator.userAgent` — what
    Google's sign-in script actually reads — still reported `Electron/29.4.6`.
  - The `onBeforeSendHeaders` hook rewrote only the outgoing `User-Agent`
    header. That never touches the JS-visible UA, so the two disagreed, which is
    itself a detection signal.

  Both are replaced by `app.userAgentFallback`, set before any window or session
  exists. It covers outgoing headers, `navigator.userAgent`, subframes and
  popups from one place, so they can no longer drift apart.
- Google account sign-in redirects through `accounts.google.com`, which the
  navigation allowlist treated as external and punted to the system browser —
  stranding the flow in a session that could never hand its cookies back. That
  host is now allowed in-window.
- `setWindowOpenHandler` denied every popup, and for an allowed URL did nothing
  at all — so the sign-in account chooser (opened via `window.open`) silently
  no-opped. Allowed URLs now load in the main window.

### Changed
- Upgrade Electron 29 → 43 (Chromium 122 → 150). Chromium 122 shipped in
  February 2024; running a 2.5-year-old engine against Google sign-in is both a
  standing CVE exposure and an increasing risk of being blocked outright.
- Derive the spoofed Chrome version from `process.versions.chrome` instead of
  hardcoding it, so the UA can never claim a Chrome version that does not match
  the renderer actually behind it.

## [1.0.1] — 2026-07-10

### Changed
- Rename project to `google-messages-windows-arm` to make the ARM focus explicit
- Replace the placeholder icon with the official Google Messages logo (rasterized
  from the messages.google.com PWA manifest, `messages_2022_round_512dp.png`),
  regenerating `assets/icons/*.png` and the multi-res `icon.ico`

### Fixed
- Packaged app crashed on launch with "Cannot find module 'electron-log'":
  the `files` list excluded `node_modules`, so production dependencies were not
  bundled into `app.asar`. Removed the exclusion (electron-builder bundles
  production deps automatically) and added `package.json` to the files list.

## [1.0.0] — 2026-07-09

Initial Windows release — ported from [google-messages-ubuntu](https://github.com/dustin-olenslager/google-messages-ubuntu).

### Added
- Full Google Messages Electron wrapper for Windows 10/11
- **Native ARM64 build** for Windows on ARM (Snapdragon X), plus x64 build
- NSIS installer (choose location, Start Menu + desktop shortcuts) and portable exe
- `app.setAppUserModelId` so Windows toast notifications attribute to the app
- Persistent session via `partition: 'persist:messages'` (auth survives restarts)
- Chrome **Windows** UA spoofing to prevent Google session degradation
- System tray with unread-count tooltip; left-click toggles window, right-click menu
- Hide-to-tray on window close (only Quit from tray / Ctrl+Q exits)
- Native Windows toast notifications bridged from the Web Notification API via preload
- Single-instance lock; second launch focuses existing window and parses `sms://`/`tel://` argv
- `sms://` and `tel://` protocol handler registration (HKCU, no admin)
- App menu: File, Edit, View, Window, Settings (auto-launch), Help
- Context menu: Cut/Copy/Paste, Reload, Inspect Element (dev only)
- Keyboard shortcuts: Ctrl+Q quit, Ctrl+W hide, Ctrl+R reload, zoom, F11 fullscreen, F12 DevTools (dev)
- Network offline detection with auto-retry on restore
- Styled error/offline page with retry button
- Window state persistence (size, position, maximized) via electron-store
- Zoom level persistence
- `electron-log` file logging to `%APPDATA%\Messages\logs\`
- Launch-at-login toggle in Settings menu (electron-auto-launch, HKCU Run key)
- `scripts/generate-ico.js` — pure-Node PNG→ICO packer (no ImageMagick/Inkscape)

### Changed (from the Linux original)
- Build targets: NSIS + portable (Windows) instead of AppImage + deb (Linux)
- Icons: multi-resolution `.ico` instead of loose PNGs for the exe/window/tray
- Accelerators: `Minimize` uses `Ctrl+M` (Linux `Super+H` has no Windows equivalent)
- `isDev` derived from `app.isPackaged` rather than `NODE_ENV` alone
