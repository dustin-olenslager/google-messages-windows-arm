# CHANGELOG

All notable changes to this project.

Format: `Added | Changed | Fixed | Removed` — present tense, with commit hash when available.

---

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
