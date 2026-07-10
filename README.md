# Google Messages for Windows on ARM

> A native-feeling Google Messages desktop app built for **Windows on ARM (Snapdragon X)** — with an x64 build too. Made with Electron.

Use Google Messages (RCS, SMS, MMS) on your Windows desktop with full system integration: toast notifications, system tray, protocol handlers, and persistent sessions.

[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D6?logo=windows11&logoColor=white)](https://github.com/dustin-olenslager/google-messages-windows-arm)
[![Arch](https://img.shields.io/badge/arch-ARM64%20%7C%20x64-4B4B4B)](https://github.com/dustin-olenslager/google-messages-windows-arm)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-29-47848f?logo=electron)](https://www.electronjs.org/)

> This is the Windows port of [google-messages-ubuntu](https://github.com/dustin-olenslager/google-messages-ubuntu).

---

## Why This Exists

Google Messages has no official Windows client. The web app at [messages.google.com](https://messages.google.com) works, but you lose:

- Toast notifications that integrate with the Windows Action Center
- A persistent taskbar/tray icon with an unread count
- Window state memory between sessions
- `sms://` and `tel://` deep-link handling from other apps
- Launch-on-login support

This app wraps the official Google Messages web interface and wires it into Windows properly — and ships a **native ARM64 build** so it runs at full speed on Snapdragon X devices (Surface Pro / Laptop 7, and other Copilot+ PCs) without x86 emulation.

---

## Features

- **RCS & SMS** — Full Google Messages experience via the official web interface
- **Native ARM64** — Runs natively on Windows on ARM; no x86 emulation overhead
- **System Tray** — Persistent tray icon with unread count in tooltip; left-click toggles the window, right-click for the menu
- **Native Toasts** — Bridges the web `Notification` API to Windows toast notifications; clicking a toast focuses the app
- **Persistent Session** — Stays paired to your Android phone between launches; no re-scanning QR codes
- **Launch on Login** — Optional auto-start via Settings menu (HKCU Run key, no admin needed)
- **Protocol Handlers** — Registers as a handler for `sms://` and `tel://` URIs
- **Single Instance** — A second launch focuses the existing window instead of opening a duplicate
- **Hide to Tray** — Closing the window minimizes to tray; the app keeps running in the background
- **Keyboard Shortcuts** — `Ctrl+Q` quit, `Ctrl+W` hide to tray, `Ctrl+R` reload, `F12` DevTools (dev only)
- **Right-Click Menu** — Context menu with Cut / Copy / Paste / Reload
- **Secure by Default** — `contextIsolation`, `sandbox`, no `nodeIntegration` in the webview
- **Crash Logs** — Structured logs written to `%APPDATA%\Messages\logs\` via `electron-log`
- **Offline Detection** — Detects network loss and auto-retries on reconnect

---

## Installation

### Option 1 — Installer (recommended)

Download the latest `Messages-Setup-*-arm64.exe` from [Releases](https://github.com/dustin-olenslager/google-messages-windows-arm/releases) and run it. The NSIS installer lets you choose the install location and creates Start Menu + desktop shortcuts.

> The installer is unsigned, so Windows SmartScreen may show a "Windows protected your PC" prompt on first run. Click **More info → Run anyway**.

### Option 2 — Portable

Download `Messages-*-arm64-portable.exe` and run it directly — no installation, no shortcuts. Settings still persist to `%APPDATA%\Messages\`.

### Option 3 — Build from source

Requirements: [Node.js 18+](https://nodejs.org/) (an **arm64** build on Windows on ARM).

```powershell
git clone https://github.com/dustin-olenslager/google-messages-windows-arm.git
cd google-messages-windows-arm
npm install
npm run generate-ico     # build the .ico from the PNG sources
npm start                # run in development
npm run build            # build the ARM64 installer + portable (-> dist\)
npm run build:x64        # build an x64 installer instead
```

Build artifacts land in `dist\`.

---

## Usage

1. Launch the app — it opens [messages.google.com/web](https://messages.google.com/web)
2. On your Android phone, open **Google Messages → Device pairing**
3. Scan the QR code shown in the app
4. You're connected — your session persists between launches

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Q` | Quit the app |
| `Ctrl+W` | Hide to system tray |
| `Ctrl+R` | Reload the page |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `F11` | Toggle fullscreen |
| `F12` | Toggle DevTools (dev mode only) |

---

## Compatibility

| Device / OS | Status |
|---|---|
| Windows 11 on ARM (Snapdragon X) | ✅ Native ARM64 — tested |
| Windows 11 x64 | ✅ Build with `npm run build:x64` |
| Windows 10 (1809+) | ✅ Should work |

Requires a desktop session. Not suitable for headless servers.

---

## Privacy & Security

- All communication goes directly between the app and Google's servers — no third-party relay
- No data is collected by this app
- Your Google session is stored locally in `%APPDATA%\Messages\` using Electron's default session storage
- The webview runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- External links open in your system browser, not inside the app

---

## Known Limitations

- **Taskbar badge** — Windows has no per-app numeric badge API in Electron; the unread count is shown in the tray tooltip instead
- **Unsigned installer** — SmartScreen may warn on first run until a code-signing certificate is configured
- **Multi-account** — One Google account per instance (same as the web app)
- **RCS feature availability** — Controlled by Google's servers, not this app

---

## Configuration

Window size, position, zoom level, and maximized state are persisted automatically to `%APPDATA%\Messages\settings.json`.

App logs are written to `%APPDATA%\Messages\logs\`.

---

## Related Projects

- **Linux** — [google-messages-ubuntu](https://github.com/dustin-olenslager/google-messages-ubuntu) (the project this is ported from)
- **Web** — [messages.google.com](https://messages.google.com) (official, browser-based)
- **Android** — [Google Messages](https://play.google.com/store/apps/details?id=com.google.android.apps.messaging) (official app)

---

## License

MIT — see [LICENSE](LICENSE) for details.

This project is not affiliated with, endorsed by, or supported by Google LLC. Google Messages and related marks are trademarks of Google LLC.
