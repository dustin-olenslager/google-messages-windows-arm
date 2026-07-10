# AGENTS.md — Google Messages Windows on ARM (Electron)

## Project
Electron desktop wrapper for https://messages.google.com/web targeting Windows 10/11, with a native **ARM64** build for Windows on ARM (Snapdragon X) plus an x64 build. Repo: `google-messages-windows-arm`. Ported from `google-messages-ubuntu`.

## Stack
- Electron (29.x)
- Node LTS (arm64 on Windows on ARM)
- CommonJS (main process)
- electron-store: window state + settings persistence
- electron-log: file logging (`%APPDATA%\Messages\logs\`)
- electron-builder: NSIS installer + portable exe
- electron-auto-launch: login startup option (HKCU Run key)
- cross-env: sets NODE_ENV on Windows for the `dev` script

## Architecture
```
src/main/       — main process modules (Node/Electron)
src/renderer/   — renderer-side HTML/JS (error page)
assets/icons/   — PNG icon sizes (16–512), rasterized from the official
                  Google Messages logo (messages.google.com PWA manifest,
                  messages_2022_round_512dp.png); 512.png is the source
assets/icon.ico — multi-res Windows icon (generated; window + tray)
build/icon.ico  — multi-res Windows icon (generated; exe + installer)
scripts/        — generate-ico.js packs the PNGs into .ico (no external tools)
```

## Key Decisions (Windows port)
- CommonJS throughout (ESM has friction with Electron main process tooling)
- `app.setAppUserModelId('com.googlemessages.windows')` set early — REQUIRED on
  Windows so toast notifications and the taskbar group attribute to this app
- UA spoofed to current Chrome **Windows** — prevents Google degrading the experience
- `isDev = !app.isPackaged || NODE_ENV === 'development'` (no `NODE_ENV=` inline on cmd)
- Protocol registration uses the `process.defaultApp` dev-path form so `sms://`/`tel://`
  resolve both when packaged and when running `electron .`
- Windows icons are `.ico` (multi-res), generated from PNGs by `scripts/generate-ico.js`
  — no ImageMagick/Inkscape needed. Frames < 256px are classic uncompressed BMP/DIB,
  256px is PNG. PNG-compressed frames below 256px pass every low-level icon API
  (LoadIcon, SHGetFileInfo, even SHGetImageList/SHIL_JUMBO) but Explorer's actual
  desktop/taskbar icon *paint* path silently falls back to a generic glyph for them —
  BMP for the small sizes is the only format that reliably renders everywhere.
- `app.setBadgeCount` is a no-op on Windows; unread count is surfaced via tray tooltip
- On window close → hide to tray; only tray Quit / Ctrl+Q actually exits
- Single instance lock; second launch focuses existing window and parses argv for
  `sms://`/`tel://` (Windows delivers protocol URIs as command-line args)
- All non-messages.google.com navigations → shell.openExternal
- `backgroundThrottling: false` — ensures notifications fire while window hidden
- contextIsolation + sandbox + no nodeIntegration on the webview

## Build
- `npm run generate-ico` — regenerate icon.ico (run once after cloning / icon changes)
- `npm start` — dev run
- `npm run build` / `build:arm64` — ARM64 NSIS + portable → `dist\`
- `npm run build:x64` — x64 build

## Known Issues / Decisions Log
- Auto-updater: stubbed only (hook comment in main.js) — not implemented
- Installer is unsigned — SmartScreen warns until a cert is added to electron-builder.yml
- DevTools only available when unpackaged or NODE_ENV=development
- **Never build/install from inside a sandboxed agent shell (e.g. an MSIX-packaged
  Claude Code session).** Windows silently redirects any packaged process's writes to
  `%LOCALAPPDATA%\Programs\...` (and `HKCU` installer registry entries) into that
  package's private `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\...` folder. From
  *inside* the sandbox everything reads back as correct (same content, same
  SHGetFileInfo/SHGetImageList results) — but the real interactive Explorer can't
  see that folder at all, so shortcuts/icons/taskbar pins silently never resolve
  (Explorer's own "Change Icon" dialog reports "Windows can't find the file" for the
  real path). Symptom: exe/window icon is correct, but desktop/Start Menu/taskbar
  icons stay a generic blank page no matter how many icon/thumbnail caches you purge
  or how many times you restart explorer.exe/dwm.exe. Fix: run `npm run build`
  wherever, but always run the resulting `dist\*-Setup-*.exe` installer by hand from
  a normal (non-sandboxed) Explorer/terminal window, not via agent automation.

## Conventions
- Explicit try/catch on all async Electron ops
- CHANGELOG.md tracks all changes
