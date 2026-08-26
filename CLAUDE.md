# CLAUDE.md — Background Tray (code repo)

This folder is the **code repo**. The **source of truth for design, spec, roadmap and working
rules lives in the Obsidian vault** (written in Korean). Read it before touching the code.

## Source of truth (Obsidian vault)

| Document | Role |
|---|---|
| `C:\Obsidian\05. Projects\BackgroundTray\00. OVERVIEW.md` | Hub — status, roadmap, open decisions, links |
| `…\01. Spec.md` | Technical spec — ★Electron integration, onunload cleanup checklist |
| `…\02. Build_and_Deploy.md` | Build, test, GitHub, community-store release |
| `…\03. Scaffold.md` | Verified scaffold files |
| `…\90. Worklog.md` / `…\91. Feedback_Backlog.md` | Worklog and backlog (self-improvement loop) |
| `C:\Obsidian\_AI_GUIDE.md` / `C:\Obsidian\_PROJECT_LOOP.md` | Vault-wide rules |

> When code and docs disagree, **the Obsidian docs win**. Reflect repo changes back into them.

## Repo facts

- **Source of truth for code**: GitHub `Synaphi/background-tray` (public). Clone it anywhere,
  work, push — local folders are throwaway working copies, not the canonical location.
- **Releases are automated**: pushing a tag that matches `manifest.json` version runs
  `.github/workflows/release.yml`, which builds and attaches `main.js` / `manifest.json` /
  `styles.css` plus build provenance as a draft release. Publish the draft afterwards.
- **Local test deploy**: `C:\Obsidian\.obsidian\plugins\background-tray\`
  (`main.js` + `manifest.json` + `styles.css`).
- ⚠️ **Real-device verification happens on one PC at a time.** `.obsidian/plugins` is covered by
  Obsidian Sync, so deploying from two machines at once makes `main.js` overwrite itself.
  CI cannot verify tray/Electron behaviour — the smoke test missed the 1.0.5 and 1.0.6 quit
  regressions, so always verify in a real Obsidian before tagging.
- **Scope**: one job only — run in background + tray icon. Extra features were deliberately
  dropped to keep the plugin small.

## Build / test

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # tsc typecheck + esbuild production (expect exit 0)
node smoke.cjs   # regression smoke over the core paths, no Electron needed (expect ALL PASS)
```

Build gotchas:

- esbuild `external` must include `electron` and `@electron/remote` (the bundle breaks otherwise).
- With `strict: true`, the `settings` field needs `settings!:` (definite assignment).

## Conventions

- **Write code, comments and user-facing strings in English.** The repo is public and takes
  outside contributions; only the Obsidian vault documents are in Korean.
- Wrap every Electron call in try/catch — never crash the app.
- `onunload` must run the full cleanup checklist (01. Spec §3.4) so disabling the plugin
  restores stock behaviour completely.

## Working rules (summary — details in _AI_GUIDE / _PROJECT_LOOP)

1. Start by reviewing the open items in `91. Feedback_Backlog`.
2. Work incrementally. After each step check the build still passes and **ask before continuing** —
   do not run to the end alone.
3. On finishing, add one line to `90. Worklog` and refresh `status` / `updated` in the related docs.
