![Background Tray — keep Obsidian in the system tray](assets/banner.jpg)

# Background Tray

Keep Obsidian running in the system tray instead of quitting when you close the window.

**One job, done well.** Background Tray is intentionally tiny and single-purpose — close-to-tray and a tray icon, nothing else. No background services, no extra UI, no bloat. Turn it off and Obsidian behaves exactly as before.

A robust, modern reimplementation of the (now unmaintained) `obsidian-tray`, built for Obsidian / Electron in 2026.

> Desktop only. Windows and macOS are fully supported. Linux tray behaviour depends on your desktop environment and is best-effort.

## Why keep Obsidian in the tray?

- **Sync keeps working in the background.** Because Obsidian stays running when you close the window, Obsidian Sync (and any other background sync) keeps going on its own instead of pausing until you reopen the app. Close the window, walk away — your vault stays up to date.
- **Instant reopen.** Bringing Obsidian back from the tray is immediate — no cold start, no vault picker.
- **Lightweight.** It just keeps the window alive in the tray; it adds no measurable overhead.

## Features

- **Run in background** — closing the window (X) hides Obsidian to the tray instead of quitting.
- **Tray icon** — left-click toggles show/hide; right-click menu: Show/Hide, Relaunch, Quit completely. Uses Obsidian's own app icon by default.
- **Single-instance focus** — relaunching Obsidian while it's hidden in the tray restores the existing window instead of opening the vault switcher. (Toggle in settings.)
- **Quit completely / Relaunch** — from the tray icon's right-click menu.
- **Custom tray icon & tooltip** — `{{vault}}` is replaced with the vault name.
- Turning the plugin off restores all default behaviour completely (no leftover listeners).

## Install

**Community store:** Settings → Community plugins → Browse → search **Background Tray** → Install → Enable.

**Manual:** copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/background-tray/`, then enable it under
Settings → Community plugins.

**BRAT (beta):** add this repo in the BRAT plugin.

## Usage

Close the window and Obsidian keeps running in the tray — and so does your sync. Click the tray icon to bring it back. To actually quit, right-click the tray icon and choose **Quit completely**.

## What's new in 1.0.7

- **Fix:** relaunching Obsidian from the taskbar while it is hidden in the tray now restores the existing window without closing the transient vault switcher. The switcher is hidden and removed from the taskbar instead, avoiding Electron's `window-all-closed` quit path.

## What's new in 1.0.6

- **Fix:** relaunching Obsidian from the taskbar while it was hidden in the tray could quit the running instance. The vault switcher is now suppressed safely without ever tearing down the existing window.
- Removed the command-palette entries to keep the plugin strictly single-purpose (everything is on the tray icon's right-click menu).

## What's new in 1.0.5

- Reopening Obsidian from the taskbar while it's hidden in the tray no longer flickers (the vault switcher is suppressed before it ever appears).
- Cleaner default tray tooltip (`{{vault}} - Background Tray`).
- Documented that keeping Obsidian in the tray lets Obsidian Sync keep running in the background.

## Building

```bash
npm install
npm run dev     # watch build → main.js
npm run build   # typecheck + production bundle
```

## License

MIT © Synaphi
