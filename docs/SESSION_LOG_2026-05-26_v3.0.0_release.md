# Session log — 2026-05-26 → v3.0.0 release

This doc exists so a future session can pick up cold. Everything below
happened in one long working day. Read this front-to-back if you've
been away.

---

## TL;DR — where we are right now

- **v3.0.0 has shipped to origin/master + the `v3.0.0` tag is pushed.**
  GitHub Actions is (or just finished) building Mac DMG + Linux AppImage
  / .deb / .rpm via the existing release.yml matrix workflow.
- **The Windows installer is local** at
  `C:\Users\extra\OneDrive\Desktop\claude-code-studio-installers\Claude-Code-Studio-3.0.0-Windows.exe`
  (91 MB, built 20:55). CI will produce an identical one and attach it
  to the draft GitHub release.
- **Origin master is at `463782d`** (the v3.0.0 merge commit). 30
  commits ahead of the pre-v3 baseline.
- **The testing remote** (`LxveAce/claude-code-studio-testing`) has
  `feature/multi-model-scaffold` and `debug-logs` branches kept in sync
  with the work. Origin doesn't carry these branch names.

## What v3.0.0 contains (the full feature list)

### Multi-model catalog
- 33 curated models in `src/main/model-catalog-seed.ts` — Qwen3 series,
  Qwen2.5 Coder series, DeepSeek-R1 distills, QwQ, Llama 3.x, Llama 4
  Scout, Gemma 3, Granite 4.1, Mistral Small, Phi-4, Qwen-VL, BGE-M3,
  Qwen3 Embedding, more.
- `ModelRegistry.recommend(hardware, project)` ranks against hardware
  tier + cwd project fingerprint. Returns top 12 with reason strings.
- `ROLE_TIER_DEFAULTS` table in seed file encodes consensus best picks
  per role × tier (e.g., `frontend:high` → `qwen2.5-coder:32b`).
- `OllamaService` — version probe, list installed, pull with streaming
  progress, cancel, delete.
- `HardwareDetection` — RAM/CPU/GPU probe via systeminformation,
  classifies into 5 tiers (toaster/low/mid/high/workstation).
- `ProjectLanguageDetect` — cwd scan reads package.json / pyproject.toml
  / Cargo.toml / etc. + package hints (react, django, fastapi, pandas)
  to weight roles.

### Multi-model UI
- `ModelsPanel.tsx` — full panel with filters (category / tier / role /
  search), recommendations row, per-model card, license disclosure,
  pull progress, launch + kill flow.
- `EmbeddedTerminal.tsx` — inline xterm attached to a running model
  PTY. Auto-selects most recent launch. Detects stale paneIds.
- `PopoutView.tsx` + `setupPopout()` in index.ts — separate BrowserWindow
  per model. URL param `?popout=<paneId>&label=<name>`. Focused on
  second pop-out attempt instead of duplicating.
- `AddModelModal.tsx` — form to add custom models with the same ID
  regex the registry uses.
- `FirstRunPicker.tsx` + `FirstRunService` — auto-opens on first launch
  (persisted at `<userData>/models-onboarding.json`). Pre-selects top
  recommendation. Parallel `ollama pull` for selected models.

### File directory navigator (new in v3.0)
- `FileTreePanel.tsx` — sidebar panel. Lazy folder tree (one IPC call
  per expansion). Recent projects with persistence at
  `<userData>/recent-projects.json` (max 12).
- `ProjectExplorer` (main service) — `listDir(root, target)`. Path-
  traversal guard rejects targets outside root. Max 2000 entries per
  call. Returns DirListing with truncation indicator.

### Resource monitoring rebuilt
- `ResourceMonitor` now tracks three buckets:
  - `claude`: PTYs running the Claude CLI (default terminal flow)
  - `models`: PTYs spawned by MODELS_LAUNCH (typically `ollama run X`)
  - `ollama`: the persistent Ollama daemon found via process-name scan
- `PtyRegistry.setPaneCategory(paneId, 'claude' | 'model')` set at spawn
  time in index.ts (`setupTerminal` defaults to claude;
  MODELS_LAUNCH explicitly sets model).
- Adjacency map built once per poll → O(n) walks per bucket (was
  O(n²)).
- ResourceSnapshot type extended: `system + claude + models? + ollama?`.
  Backward-compatible — old renderers that read only `system + claude`
  still work.
- `ResourcePanel.tsx` renders the new buckets when present.

### Cost service
- `COST_RATES` updated to May 2026 Anthropic pricing — Haiku $1/$5 (was
  $0.8/$4). Sonnet $3/$15 and Opus $15/$75 unchanged.
- Disclaimer expanded to call out that local models via Ollama are free
  and never counted.

### GitHub
- `GitHubPanel.tsx::extractError()` classifies Octokit errors —
  401 (token revoked), 403 (rate limit with reset time parsing), 404,
  network errors. One-line actionable messages instead of stack traces.

### Settings additions
- Claude CLI section gained `ClaudeCliFlagsSection` —
  `--dangerously-skip-permissions` toggle. Persisted at
  `<userData>/cli-flags.json` via `src/main/cli-flags.ts`. PtyManager
  reads at spawn time and prepends the flag to args ONLY when no
  `opts.command` override (i.e., spawning the bundled claude CLI).
  Model PTYs are never affected.
- New `DangerZoneSection` — Reset User Data wipes 18 known JSON/JSONL
  files we wrote under `<userData>` (leaves Chromium profile). Uninstall
  is cross-platform now (Windows spawns NSIS uninstaller; macOS opens
  Finder at /Applications + returns "drag to Trash" guidance; Linux
  detects install format and returns apt/dnf/pacman/rm hint).
- About row reads from `app:version` IPC (no more hardcoded "2.0.0").

### NSIS installer (Windows)
- Step 5 (Ollama) is detection-only. Pre-beta.2 it downloaded + silently
  installed Ollama (~2 GB) during install — UX disaster (no progress
  bar in NSIS for a single curl call). Now logs whether Ollama is
  present so the in-app catalog knows what to render; offers install via
  the FirstRunPicker link to ollama.com/download.
- `customUnInstall` now MB_YESNO prompts to also remove userData JSON
  files (default No so a planned reinstall keeps settings). Lists every
  file explicitly so the Chromium profile isn't accidentally nuked.

### Auto-updater
- Gate 4 added in `UpdaterService.start()` checks
  `/-beta\./i.test(app.getVersion())` and short-circuits to disabled.
  Fixes the 404 stack trace from electron-updater looking for
  `latest.yml` on a release that doesn't have one.

### Status bar
- Renders current git branch + dirty dot when cwd is a repo. Polls
  every 30s + on window focus.
- Version label reads from app:version IPC.

### TitleBar
- Same `app:version` IPC source. Pre-v3 was hardcoded `v1.0.0` since
  v1.0 — never updated through v2.

### Sign-in flow
- `CliAuthOnboarding.handleLoginInTerminal` now sends `/login` (Claude's
  in-session slash command) instead of `claude login`. The embedded PTY
  auto-spawns Claude, so the active pane is always a running Claude
  session — `/login` triggers OAuth from inside; `claude login` would
  just be chat text Claude responded to with "I notice you typed claude
  login as a message…".
- `CliService.getStatus` heuristic loosened — only returns
  `authenticated: false` when `claude doctor` stderr explicitly mentions
  auth phrases. Any other non-zero exit defaults to authenticated=true
  so a network blip doesn't pop the modal needlessly.

## What deliberately stayed deferred

Each was scoped and consciously postponed:

- **Per-provider API key entry** (OpenAI, Gemini, OpenRouter) — needs
  AuthPanel generalization beyond the Anthropic-only flow. ~3-4 days.
- **Model comparison view** — parallel pane + synced input + result
  diff. UI complexity warrants its own push.
- **Embedding-RAG over past sessions** — vault index + chunking + vector
  store + query UI. ~1-2 weeks.
- **Per-model VRAM tracking** — requires vendor GPU SDKs (NVML, Metal
  Performance Shaders Counters, ROCm SMI). Resource panel shows RAM by
  bucket but not VRAM per loaded model.
- **macOS code signing** — requires Apple Developer Program ($99/yr) +
  osxSign config keyed to env vars. Without it users see the "App is
  damaged" Gatekeeper warning on first launch (workaround: right-click
  → Open → Open).

## Build infrastructure (important for future rebuilds)

### Windows local build — the 7za winCodeSign symlink hack

electron-builder's `app-builder.exe` shells out to 7za.exe to extract
`winCodeSign-2.6.0.7z`, which contains macOS dylib symlinks (libcrypto,
libssl). Windows requires admin or Developer Mode to create symbolic
links. On a stock user account, 7za returns exit 2 with "Cannot create
symbolic link" errors — even though every Windows file extracts fine.
app-builder propagates that exit 2 as a fatal error.

**Workaround** (local-only, since CI's `windows-latest` runner now has
Dev Mode explicitly enabled via the workflow):

- `C:\Users\extra\ccs-build\7za-wrapper.cs` — tiny C# wrapper compiled
  with `csc.exe` (from .NET Framework 4.x — ships with Windows). Calls
  the real 7za, captures stderr, returns 0 if the only failures were
  symlink-related.
- Installed at `node_modules\7zip-bin\win\x64\7za.exe` (real 7za moved
  to `7za.real.exe` sibling).
- `node_modules` is .gitignored so this isn't checked in. To rebuild
  Windows locally after `npm install` clobbers it, re-run:
  ```bash
  cd C:/Users/extra/OneDrive/Desktop/claude-code-studio/node_modules/7zip-bin/win/x64
  cp 7za.exe 7za.real.exe
  cp /c/Users/extra/ccs-build/7za-wrapper.exe 7za.exe
  ```
- The source for the wrapper is at `C:\Users\extra\ccs-build\7za-wrapper.cs`.
- CI runners have Dev Mode enabled via `Set-ItemProperty
  HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock
  AllowDevelopmentWithoutDevLicense 1` in release.yml's "Enable Windows
  Developer Mode" step — they don't need the wrapper.

### OneDrive lock issue

The source folder is on OneDrive
(`C:\Users\extra\OneDrive\Desktop\claude-code-studio`). OneDrive
periodically locks files during sync, which broke electron-builder's
`dist/` cleanup. Workaround: build to a non-OneDrive output dir:

```bash
node node_modules/electron-builder/out/cli/cli.js --win --publish never \
  --config.directories.output=C:/Users/extra/ccs-build/dist
```

Then copy the resulting .exe to the installers folder manually:
```bash
cp /c/Users/extra/ccs-build/dist/Claude-Code-Studio-3.0.0-Windows.exe \
   /c/Users/extra/OneDrive/Desktop/claude-code-studio-installers/
```

### Node 22 not on PATH

This shell has Node 22 at `C:\Users\extra\nodejs-22\` but it's not on
PATH. Every build/typecheck command starts with:
```bash
export PATH="/c/Users/extra/nodejs-22:$PATH"
```

### CI workflow (release.yml)

- Tag-driven: pushes matching `v*.*.*` fire the workflow.
- Matrix builds on `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Looks for `docs/RELEASE_NOTES_${tag}.md` (which exists for v3.0.0 —
  created in this session) and uses it as the release body.
- Each matrix job calls `gh release create --draft` (tolerates "already
  exists" if a sibling job got there first), then `gh release upload
  --clobber` for its OS's installers.
- File globs are deliberate: only the user-facing installers go up.
  `.exe.blockmap`, `.nsis.7z`, `latest.yml` are excluded.
- Failure fallback: pushes failure log to an orphan `ci-logs` branch on
  the repo, viewable via raw.githubusercontent.com without auth.

## Branches + remotes

- **origin** = `https://github.com/LxveAce/claude-code-studio.git` (public)
  - `master` — v3.0.0 (commit `463782d`)
  - `v1.0.0` tag (commit `04f035b`)
  - `v2.0.0` tag (commit `a341641`)
  - `v3.0.0` tag (commit `463782d` — just pushed)
  - Other phase branches (phase-4, phase-5, etc.) — historical, ignore
- **testing** = `https://github.com/LxveAce/claude-code-studio-testing.git` (private)
  - `master` — mirror of origin master
  - `debug-logs` — debug log feature, testing-only (commit `159debe`)
  - `feature/multi-model-scaffold` — was the v3 dev branch, now merged
    into origin master. Latest tip `8e7ff9f`.

## Folder layout on disk

- `C:\Users\extra\OneDrive\Desktop\claude-code-studio\` — source repo
  (OneDrive synced, contains _backups/ folders from each push)
- `C:\Users\extra\OneDrive\Desktop\claude-code-studio-installers\` —
  release binaries (v2.0, v3.0 stable, three v3 betas archived)
- `C:\Users\extra\ccs-build\` — local build output dir (avoids OneDrive
  lock issues). Contains `dist/` from each build + the 7za wrapper.
- `C:\Users\extra\nodejs-22\` — portable Node 22 install used for builds
- `%APPDATA%\Claude Code Studio\` — userData for the installed app

## Files added or substantially modified during this session

### New files in src/

- `src/main/ollama-service.ts`
- `src/main/hardware-detection.ts`
- `src/main/project-language-detect.ts`
- `src/main/project-explorer.ts`
- `src/main/disk-info.ts`
- `src/main/first-run-service.ts`
- `src/main/cli-flags.ts`
- `src/main/model-catalog-seed.ts`
- `src/renderer/components/models/ModelsPanel.tsx` (rewritten)
- `src/renderer/components/models/EmbeddedTerminal.tsx`
- `src/renderer/components/models/PopoutView.tsx`
- `src/renderer/components/models/AddModelModal.tsx`
- `src/renderer/components/models/FirstRunPicker.tsx`
- `src/renderer/components/project/FileTreePanel.tsx`

### Modified

- `src/main/index.ts` — wired all new services + their IPC handlers
- `src/main/pty-manager.ts` — accepts optional command/args opts;
  reads cli-flags for `--dangerously-skip-permissions` auto-inject
- `src/main/pty-registry.ts` — pane category tracking, `listModelPanes()`
- `src/main/cli-service.ts` — auth heuristic loosened
- `src/main/cost-service.ts` — rate table updated, disclaimer expanded
- `src/main/resource-monitor.ts` — full rebuild for 3-bucket tracking
- `src/main/updater-service.ts` — beta-skip gate
- `src/main/session-service.ts` — added 'files' to valid panel IDs
- `src/shared/types.ts` — new types for all the v3 additions
- `src/shared/ipc-channels.ts` — new channels (long list)
- `src/preload/preload.ts` — new namespaces exposed
- `src/declarations.d.ts` — ambient types for new namespaces
- `src/renderer/App.tsx` — wires new panels, popout-mode short-circuit,
  sign-in flow comment updated
- `src/renderer/components/layout/Sidebar.tsx` — Files icon added
- `src/renderer/components/layout/TitleBar.tsx` — version from IPC
- `src/renderer/components/layout/StatusBar.tsx` — version from IPC,
  git branch badge
- `src/renderer/components/resources/ResourcePanel.tsx` — bucket UI
- `src/renderer/components/settings/SettingsPanel.tsx` — CLI flags
  toggle + danger zone + about-version from IPC
- `src/renderer/components/github/GitHubPanel.tsx` — extractError
  classifies Octokit failures
- `src/renderer/components/auth/CliAuthOnboarding.tsx` — sends `/login`
- `build/installer.nsh` — Ollama bundle removed (detection-only),
  uninstaller userData prompt added
- `electron-builder.yml` — Mac DMG + Linux AppImage/.deb/.rpm targets
  (carried over from v2 — unchanged in v3)
- `.github/workflows/release.yml` — matrix build (carried over from v2)
- `package.json` — version bumped through beta.1 → beta.2 → beta.3 →
  3.0.0
- `docs/MULTI_MODEL.md` — multi-model design doc
- `docs/BACKLOG.md` — beta entries + shipped marking + v3.0.0-beta.4
  queue (now empty since we shipped)
- `docs/RELEASE_NOTES_v3.0.0.md` — created for CI to attach to the draft
  release
- `README.md` — feature bullet rewritten + platform support line bumped
- `.gitignore` — added `_backups/` (local snapshots)

## Backup folders (local-only, .gitignored)

Each major push left a timestamped backup of pre-edit files:

- `_backups/2026-05-26-pre-fullscope/` — pre multi-model expansion
- `_backups/2026-05-26-followup-features/` — pre xterm + popout + add-model
- `_backups/2026-05-26-redteam-v3/` — pre version-display + claude-login
  flow + auth heuristic + NSIS Ollama removal
- `_backups/2026-05-27-beta3/` — pre beta.3 work (resource buckets, file
  tree, danger zone, cli flags, status bar git branch)

Useful as a diff baseline if anything regresses and we need to spot
what changed.

## Saved memories that constrain future work

Stored in `C:\Users\extra\.claude\projects\C--Users-extra--local-bin\memory\`:

- `project_claude_code_studio.md` — local path, Node 22 gotcha,
  packaging tripwires, PAT handling pattern
- `feedback_ccs_installer_scope.md` — never chain large optional
  downloads (Ollama, model runtimes) into the NSIS bootstrap; install
  lazily from inside the UI. Saved after the beta.1 install pain.
- `feedback_lmm_workflow.md` — apply LMM thinking discipline + red-team
  after each phase

If you're picking this up later: check `MEMORY.md` index first.

## Known issues / things to verify when picking up

1. **CI workflow status** — after the tag push, verify
   https://github.com/LxveAce/claude-code-studio/actions shows all 3
   matrix jobs green. If macOS / Linux failed, check the `ci-logs`
   branch on the repo for the captured build log.
2. **Draft release page** — once CI's done, the draft at
   https://github.com/LxveAce/claude-code-studio/releases/tag/v3.0.0
   should have all 5 installer files attached. **You still need to
   click "Publish release" manually** — drafts are invisible to
   non-collaborators.
3. **macOS Gatekeeper** — first launch will warn "App is damaged or
   can't be opened" on unsigned builds. Documented in release notes
   but worth noting in any future Mac user feedback.
4. **NSIS uninstaller userData prompt** — never been validated against
   an actual uninstall flow on a real Windows machine running v3.0.0.
   First user who uninstalls will be the test.
5. **Auto-updater path forward** — beta builds skip; stable v3.0.0 will
   auto-update normally. But v3.0.0 → v3.0.1 hasn't been tested. If
   v3.0.1 happens, verify the update flow before pushing the tag.

## What's next (if you're picking up to do more work)

Queued in `docs/BACKLOG.md` under "★ v3.0.0-beta.4 — queued for next
push" (now stale — that section was for beta.4 which we skipped by
going straight to 3.0.0; rename or empty it).

Realistic next priorities:

1. **Per-provider API key entry** — the catalog has slots for OpenAI /
   Gemini / OpenRouter API models but no UI to enter keys. Extend
   `AuthPanel` beyond Anthropic.
2. **macOS code signing** — Apple Developer Program + osxSign config.
   Removes the Gatekeeper warning.
3. **Model comparison view** — parallel pane + synced input + result
   diff. UI complexity warrants its own push.
4. **Embedding-RAG over past sessions** — catalog has embedding models
   but no indexing pipeline.
5. **VRAM per loaded model** — vendor GPU SDK integration.
6. **Update beta-skip gate test** — write a unit-style test for the
   `/-beta\./i` regex so a future version naming change doesn't
   accidentally re-enable the updater on a beta.

## How to resume work (cold-start checklist)

1. `cd C:/Users/extra/OneDrive/Desktop/claude-code-studio`
2. `git fetch origin && git fetch testing`
3. `git log --oneline -10 origin/master` — confirm `463782d` is the v3
   merge.
4. Read this file (you are now).
5. Read `docs/MULTI_MODEL.md` for the catalog architecture context.
6. Read `docs/BACKLOG.md` for what's still queued.
7. Check
   https://github.com/LxveAce/claude-code-studio/releases/tag/v3.0.0
   — if draft, publish; if published, you're past the release point.
8. If working on Windows: `export PATH="/c/Users/extra/nodejs-22:$PATH"`
   before any `node` / `npm` invocation.
9. If rebuilding Windows installer locally: re-apply the 7za wrapper
   (`cp /c/Users/extra/ccs-build/7za-wrapper.exe
   node_modules/7zip-bin/win/x64/7za.exe`).

Good luck.
