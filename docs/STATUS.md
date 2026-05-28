# Claude Code Studio — Testing Repo STATUS

> **Version:** v3.1.0
> **Last updated:** 2026-05-27 (post-handoff continuation — original 3-item deferred list fully drained: TerminalTabs + Commands-tab-mirror + Claude chat-mode profile all shipped)
> **Branch this describes:** `master` (testing repo only — `LxveAce/claude-code-studio-testing`); open feature branches: `feature/terminal-tabs-wiring` (PR #18), `feature/commands-tab-mirror` (PR #19) stacked on it, `feature/claude-chat-mode` stacked on that
> **Latest session log:** [`SESSION_LOG_2026-05-27_night-terminaltabs.md`](./SESSION_LOG_2026-05-27_night-terminaltabs.md) (extended with Commands-tab-mirror + chat-mode addendums)
> **Latest verification report:** [`VERIFICATION_2026-05-27.md`](./VERIFICATION_2026-05-27.md)

This is the always-current pickup doc. A fresh `git clone` + reading this file should
tell the next Claude session (on any machine) exactly where the work stands.

---

## TL;DR for the next session

Pick this up by:

1. **Read this whole file** — every recent change is summarized below.
2. **Check the v3.1.0 GitHub Release** at
   https://github.com/LxveAce/claude-code-studio-testing/releases/tag/v3.1.0 —
   the `release.yml` CI workflow builds installers for all 3 OSes
   (`Claude-Code-Studio-3.1.0-Windows.exe`, `-Mac.dmg`, `-Linux-*.{AppImage,deb,rpm}`)
   and uploads them as release assets when a `v*.*.*` tag is pushed. If the
   release doesn't have assets yet, the workflow may still be running — see
   https://github.com/LxveAce/claude-code-studio-testing/actions
   (look for the "Release" workflow on tag `v3.1.0`).
3. **Read the "Deferred — pick up here" section** — three items the user asked for
   that I scoped + scaffolded but did not ship in this session: TerminalTabs wiring
   into App.tsx, Claude chat-mode (`--output-format=stream-json`) for the chat skin,
   and Commands tab mirroring the active model.
4. **Open issues**: see issue tracker on the testing repo.

### Installer build notes

- **The agent tried building the installer locally on 2026-05-27 and failed**
  at `winCodeSign` extraction: `Cannot create symbolic link : A required
  privilege is not held by the client.` Cause: Windows Dev Mode is not on for
  the user's account, and the agent shell isn't elevated.
- **Workaround used**: tagged `v3.1.0` and pushed — `release.yml` workflow
  triggers on tag and builds installers on GitHub Actions hosted runners
  (which have the needed permissions).
- **First v3.1.0 CI release failed** with `NSIS warning 6001 — Variable
  "OllamaWantsInstall" not referenced` (false positive caused by macro-scoped
  usage). Fixed with a targeted `!pragma warning disable 6001` in
  `build/installer.nsh`. Tag force-moved + workflow re-triggered. Should
  succeed on the second pass.
- **To build locally** (if you want a fresh installer at home): enable Windows
  Dev Mode (Settings → Privacy & Security → For developers → Developer Mode
  ON), then `npm run dist`. Output: `dist/Claude-Code-Studio-3.1.0-Windows.exe`.

---

## Where we are

The official release (`LxveAce/claude-code-studio` master) shipped **v3.0.0** on
2026-05-26. The testing repo is the active dev branch — every R&D feature lands
here first.

**testing/master is currently at PR #17 merged.** Sequence of work this evening:

| PR | Topic | Status |
|---|---|---|
| #13 | Local-AI PATH resolver (the "GPU ignored" bug — root cause was PATH, then…) | merged |
| #14 | Chat-skin overlay v1 (now superseded by v2 in #17) | merged |
| #15 | **GPU routing fix** + Liquid LFM catalog + Jetson Thor tier | merged |
| #16 | Chat-skin redesign v1 + multi-model tab strip in Models panel | merged |
| #17 | **Chat-skin v2** + per-pane popout skin + + tab picker + auth auto-detect + BitNet + TerminalTabs scaffolding | merged |

---

## What's live (deep dive)

### Claude chat-mode profile (this session, third commit)

New catalog entry `api.anthropic.claude-chat` that spawns
`claude --print --input-format=stream-json --output-format=stream-json --verbose`.
Paired with a new JSON-stream rendering path in `ChatSkinOverlay` so
the ✦ Chat skin produces structured messages instead of trying to
sanitize Claude's TUI repaint sequences (the "garbled chat text"
problem from the morning handoff).

Architecture:
- `src/renderer/components/chat-skin/json-stream-parser.ts` — new file.
  Two pure modules: `JsonStreamParser` (generic JSONL with partial-line
  buffer) and `interpretClaudeChatEvent` (Claude SDK event shapes →
  chat-renderer actions). Plus `encodeUserMessageJsonl` for the
  outbound wrap.
- `ChatSkinOverlay` gains a `profile` prop. When profile is in the
  `JSON_STREAM_PROFILES` set, `ingestJsonChunk` runs instead of
  `appendAssistantChunk` and `send()` wraps user text via
  `encodeUserMessageJsonl` before `sendInput`.
- `TerminalTabs` → `EmbeddedTerminal` → `ChatSkinOverlay` plumb
  `profile` through.
- New `claude-chat` family in `command-families.ts` with intentionally
  empty slash list + `emptyMessage` explaining slash commands don't
  apply in stream-json mode.

Behavior:
- Pick "Claude (Chat)" from the `▼` profile picker → new tab launches
  with JSON I/O.
- Toggle ✦ Chat skin → see a structured chat UI consuming JSON events:
  `system` init → `"Claude JSON session ready"` system note;
  `assistant` / `result` → bubbles; `content_block_delta` → live
  streaming text appended to the active bubble; non-JSON noise →
  `_(non-JSON line: …)_` italic bubbles so nothing's silently dropped.
- Type a message → encoded as Anthropic Messages API user-message
  event with `\n` framing → fed to Claude's stdin.
- Toggle skin OFF → xterm shows the raw JSONL stream.

Caveats (carry forward):
- Tool-use / thinking content blocks dropped today (M-1 in
  `SECURITY_REVIEW_CHAT_MODE.md`).
- No "stop generation" affordance in chat-mode (M-2).
- Flag surface unverified against an actual Claude binary (H-1) — first
  manual run will expose any mismatch as a clear error bubble.

### Commands sidebar mirrors active tab + EmbeddedTerminal sender (this session, second commit)

The Commands sidebar (Quick Actions / All Commands / Shortcuts) now
follows the active terminal tab's CLI. Six families today:
**Claude / Ollama / Aider / Gemini / BitNet / Terminal (unknown).**

- Data lives in `src/renderer/components/commands/command-families.ts` —
  one `CommandFamilyConfig` per CLI with label, grouped slash commands,
  categorized quick commands, and REPL shortcuts. Curated, not
  exhaustive; add to a family by editing the literal in that file.
- `CommandsPanel` accepts a `family` prop; renders the matching config.
  A small uppercase chip in the header announces which CLI's commands
  are showing ("CLAUDE", "OLLAMA", etc.) so the user knows why the
  list changed when they switched tabs.
- `QuickCommands` is now data-driven; self-heals when its `categories`
  change so a stale active-category pill doesn't survive a family swap.
- Empty families (BitNet, Unknown) surface a friendly message rather
  than an empty pane.
- `deriveCommandFamily(profile, catalog)` in
  `command-families.ts` is the sole derivation point — App.tsx calls it
  once and threads the result through `RightPanel`.

**H-1 fix (was: model PTYs silently dropped palette/snippet text):**
`EmbeddedTerminal` now accepts and calls `registerSender`, matching
TerminalPanel's pattern. App's `sendToActive` reaches model PTYs as
well as Claude tabs. The new Commands sidebar's Quick Action buttons
literally would not have worked on a model tab before this fix.

Verification: `npx tsc --noEmit` clean, `npx vite build` clean. Manual
smoke list in `docs/security-reviews/SECURITY_REVIEW_COMMANDS_TAB.md`.

### TerminalTabs wiring + session schema v2 (this session)

Replaces the SplitLayout pane tree in `App.tsx` with the
Windows-Terminal-style `TerminalTabs` strip + content host scaffolded in
PR #17. `App.tsx` now owns a `tabs: TerminalTab[]` + `activeTabId` pair
instead of `layout: SplitNode`; `activePaneId` is derived from the active
tab. `SplitLayout.tsx` deleted.

Session schema bumped **v1 → v2**:

- `SessionState` shape: `{ version, activePanel, theme, tabs: PersistedTab[], activeTabId }`.
- `SessionService` migration extracts the first pane id from any v1 layout
  tree and produces a single Claude tab on that paneId, so an alive PTY
  from a hot-reload reattaches instead of orphaning.
- Only Claude tabs are persisted; model tabs are ephemeral by design
  (relaunching them silently would trigger surprise downloads / GPU
  loads).
- Sanitizer caps: 32 tabs, 64-char ids, paneId regex `^[A-Za-z0-9_\-:]+$`,
  drops `profile !== 'claude'`, dedupes id and paneId.

Palette tab actions replace the old pane actions:
- "New Claude tab", "Close tab", "Next tab", "Previous tab", "Reset tabs"
- (Split-horizontal / split-vertical removed — not meaningful in a tab
  model.)

Race fix in the scaffold: `TerminalTabs`'s `addClaudeTab` /
`addModelTab` / `closeTab` were calling `onTabsChange` with closure-based
arrays, which dropped any tabs added concurrently during a model-launch
await window. Fixed by changing the prop to
`React.Dispatch<React.SetStateAction<TerminalTab[]>>` and using updater
functions throughout. See `docs/security-reviews/SECURITY_REVIEW_TERMINAL_TABS.md`
finding C-1.

Verification: `npx tsc --noEmit` clean, `npx vite build` clean. Manual
smoke list in the security review file.

### GPU routing (PR #15) — fixes "my dedicated GPU is ignored"

Root cause: Ollama reads GPU env vars (`CUDA_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`,
`OLLAMA_VULKAN`, etc.) at `ollama serve` startup — NOT per-`ollama run`. Our code
was injecting env into the wrong process. Fix in `src/main/gpu-prefs.ts` +
`OllamaService.daemonStart()` now passes the right env via `buildDaemonEnv()`.

UI: Models panel's hardware banner has a "GPU routing: Auto / Force GPU / Force CPU"
dropdown plus a per-GPU picker if multiple dedicated GPUs are detected. Apply button
restarts the daemon with the new env. New types: `GpuVendor`, `GpuBackend`, `GpuInfo`,
`GpuMode`, `GpuPrefs` in `src/shared/types.ts`.

### Chat skin v2 (PR #17) — fixes "looks horrible" + "CLI gets translated weirdly"

Two passes addressing user feedback. Final state:

- **Layout**: persona header at top (avatar + model name + subtitle); 720px-centered
  column; soft rounded bubbles for BOTH roles (no per-message avatars); pill composer
  with circular gradient send button.
- **Markdown rendering** via `react-markdown` + `remark-gfm` + `react-syntax-highlighter`
  (Prism, oneDark). Code blocks have a header bar with language + Copy button.
- **Aggressive sanitizer** for incoming bytes:
  - Detects screen-clear sequences (`\x1b[2J`, `\x1bc`, `\x1b[?1049[hl]`, `\x1b[H`) in
    the RAW bytes before stripping. On detection: starts a NEW assistant message
    instead of appending — stops the TUI-repaint duplication (the "Accessing workspace
    Quick safety check…" appearing twice in the user's screenshot).
  - Strips CSI/OSC/DCS, bare ESC/BEL/NUL, CR-overwrite lines, collapses 3+ newlines.
- **`InteractivePromptBanner`** above any assistant bubble whose content matches
  selection-menu patterns ("Enter to confirm", "Esc to cancel", "1. Yes 2. No",
  "Select an option", "❯ <number>"). Tells the user to switch to Terminal view to
  respond.
- **Per-pane skin toggle** persisted via `localStorage` (`chat-skin:<paneId>`). Works
  on TerminalPanel AND EmbeddedTerminal (so model panes + popout windows all support
  the chat skin and remember per-pane choice across reloads).
- **Streaming cursor** (▍ blinking at end of latest assistant message while a chunk
  arrived within 800ms).

### Auth auto-detect (PR #17) — fixes "Claude was authed but the app doesn't know"

`ProviderAuthService.list()` now returns each entry with an `AuthSource` field:
- `stored` — safeStorage entry exists (canonical).
- `env` — env var is set in `process.env` (inherited from shell; spawned PTYs get it
  too, no need to copy).
- `cli-oauth` — Anthropic only: `~/.claude.json` or `~/.claude/oauth_*.json` exists
  with non-trivial content (looks for `oauthAccount` / `access_token` /
  `refresh_token`). Token is not exportable, we just acknowledge it.
- `none` — nothing detected.

ProviderKeysList shows colored tags next to each provider:
- 🟢 "CLI OAuth" green — Anthropic via `claude /login`.
- 🔵 "env var" blue.
- 🟣 "saved" purple.

Button label says "Override" instead of "Set" when an external source is detected.

### Multi-model tab strip in Models panel (PR #16 + #17)

Running models render as a horizontal tab bar (with status dot + name + ↗ popout +
× close per tab). New "+ New" tab at the end opens `TabModelPicker` — a searchable
catalog dropdown grouped by API / Local. Picking a model fires the existing launch
flow (license + CLI-detect + API-key gates).

The terminal popout (`models.popout(paneId, label)`) opens a new BrowserWindow
that ALSO shows the chat-skin toggle and respects the per-paneId preference.

### Catalog additions

- **Liquid AI LFM2.5** — 2 entries (`ollama.lfm2.5-350m`, `ollama.lfm2.5-1.2b-instruct`)
  via `hf.co/LiquidAI/...:Q4_K_M`. LFM1.0 custom license flagged. Edge tier.
- **Jetson AGX Thor** — new `'jetson-thor'` hardware tier (workstation-equivalent
  compute, 128 GB unified memory). 28 existing workstation-class catalog entries
  tagged with it.
- **BitNet b1.58 2B (Microsoft)** — added in PR #17. Uses `command: 'bitnet'` (the
  bitnet.cpp runner — not Ollama). Flagged so users see the install requirement
  before launch.

### Audit fix-pass

From the deep code audit (3 parallel Explore agents on main services + renderer +
build). Real bugs fixed:
- `cli-flags.ts` + `compact-controller.ts` config-write — both were direct
  `writeFileSync` (non-atomic). Now use the standard tmp+rename pattern.
- Sidebar buttons had no `aria-label` / `data-panel` — added both. (a11y win +
  enabled the CDP-driven runtime verifier.)

### Runtime verification harness

`scripts/runtime-verify.mjs` — spawns Electron with `--remote-debugging-port=9222`,
polls for React mount, enumerates `[data-panel]` sidebar buttons, clicks each one,
captures any console/exception events, writes per-tab pass/fail to
`runtime-verify-summary.md`. Latest run: **12/12 tabs pass with zero console errors**.

To run again: `node scripts/runtime-verify.mjs` (will spawn Electron, ~3 min total).

---

## Deferred — pick up here next session

**The original 3-item deferred list from the morning handoff is fully
drained.** All three shipped this session:
- #1 TerminalTabs wiring → PR #18
- #2 Commands-tab-mirror + H-1 fix → PR #19
- #3 Claude chat-mode profile → PR #20 (stacked)

Next session starts with a clean blank slate. The items below are
*new* follow-ups surfaced by the three red-team reviews, not the
original deferred list.

### Followups surfaced this session (priority order)

Two of the original six shipped in PR #21 (polish pass — Aider submit
flag + renderer-side tab cap). Four remain:

1. **Verify Claude CLI flag surface for chat-mode** (H-1 in
   `SECURITY_REVIEW_CHAT_MODE.md`). The catalog uses
   `['--print', '--input-format=stream-json', '--output-format=stream-json', '--verbose']`
   — pending real-app confirmation that the local `claude` binary
   accepts those flags + emits the assumed event shapes. First manual
   run will surface any mismatch as a parse-error bubble.
2. **Tool-use / thinking renderer in chat skin** (M-1 in chat-mode
   review). `extractTextFromMessage` drops non-text content blocks
   today. Render `tool_use` as a compact card; `tool_result` as
   collapsible.
3. **"Stop generation" button in chat skin** (M-2 in chat-mode
   review). Replaces the send button while streaming; sends `\x03`
   or an abort JSON event.
4. **`EmbeddedTerminal` PID surfacing** (M-2 in TerminalTabs review).
   StatusBar shows PID 0 for model tabs because `EmbeddedTerminal`
   doesn't subscribe to a `ready` event.

None of these block the next session — they're polish on shipping
work.

---

## What still works (regression check from earlier sessions)

- All 12 sidebar tabs render without console errors (latest CDP verifier run).
- TypeScript compile clean.
- Vite production build clean.
- Local Ollama models spawn correctly (PATH resolver from PR #13 + GPU env from PR #15).
- API key UI: pre-launch modal, PTY interceptor, env injection at PTY spawn — all wired.
- 3 providers (Gemini / Aider / OpenRouter via Aider) in catalog.
- Cat 7 Ollama daemon autostart if local models registered.
- Cat 8 installer wizard + Ollama opt-in + BMP chrome.
- Themes (13 built-ins + custom editor) + per-window state persistence.

---

## Known issues / gotchas (carry forward)

- **node-pty patches**: postinstall requires Windows C++ Build Tools (VS 2022 +
  Windows SDK).
- **NSIS Dev Mode**: `npm run dist` needs Windows Developer Mode enabled OR running
  as Administrator (for symlinks during electron-builder packaging).
- **Cat 7 daemon poll**: 15s window. If Ollama is slow on the user's box, increase
  the `TIMEOUT_MS` in `OllamaService.daemonStart`.
- **Claude TUI in chat skin**: even with the v2 sanitizer, some selection prompts
  won't render perfectly — the proper fix is the chat-mode profile (item #1
  in Deferred above).
- **Model tab StatusBar PID**: shows 0 for model tabs because
  `EmbeddedTerminal` doesn't subscribe to a `ready` event for
  already-spawned PTYs. Cosmetic only — Resource panel still tracks
  the model PTY bucket. Tracked as M-2 in
  `SECURITY_REVIEW_COMMANDS_TAB.md`.
- **Model tab StatusBar PID display** is the only remaining UI gap
  from the prior red-teams. Resource panel still shows the model
  PTY bucket correctly; this is the PID footer cosmetic only.

---

## Local setup on a new machine

```powershell
# 1. Clone (testing repo)
git clone https://github.com/LxveAce/claude-code-studio-testing.git
cd claude-code-studio-testing

# 2. Install deps (will rebuild node-pty for Electron — needs VS Build Tools)
npm install

# 3. Apply node-pty patches (runs automatically as postinstall, but in case)
node scripts/patch-node-pty.js

# 4. Launch the app in dev mode
npm start

# 5. (Optional) Build a Windows installer — REQUIRES Dev Mode
#    Tried building this from the agent's shell on 2026-05-27 — failed at
#    the NSIS step with "Cannot create symbolic link : A required privilege
#    is not held by the client." winCodeSign unpacks symlinks to
#    %LOCALAPPDATA%\electron-builder\Cache\winCodeSign\…\darwin\…\libcrypto.dylib
#    which needs SeCreateSymbolicLinkPrivilege.
#
#    Two ways to fix on Windows:
#      a) Settings → Privacy & Security → For developers → Developer Mode ON.
#      b) Run the build shell as Administrator (right-click → Run as administrator).
#    Then:
npm run dist
# Output: dist/Claude-Code-Studio-3.1.0-Windows.exe

# 6. (Optional) Run the CDP-driven tab-by-tab verifier
node scripts/runtime-verify.mjs
# Output: runtime-verify-summary.md (markdown pass/fail per sidebar tab)
```

If `npm install` fails on node-pty rebuild: install Visual Studio 2022 with the
"Desktop development with C++" workload + Windows 10/11 SDK, then re-run.

---

## Repo split

- **`claude-code-studio`** (public release) — slim. End-user-facing only.
- **`claude-code-studio-testing`** (this repo) — full dev archive + every R&D
  feature in flight.

Promotion path: testing/master → cherry-pick / PR to public repo when ready
to ship a public update.

---

## Pointers

- **Original R&D plan (now committed to repo):**
  `docs/PLAN_2026-05-27_rnd-push.md`. The full plan I worked from at the
  start of the day — Cat 1–9 categorization + execution model.
- **R&D kickoff session log (morning):**
  `docs/SESSION_LOG_2026-05-27_rnd-kickoff.md`.
- **Evening session log (everything after the morning push):**
  `docs/SESSION_LOG_2026-05-27_evening.md` — chat-skin v2, GPU routing,
  auto-detect, BitNet, TerminalTabs scaffolding, v3.1.0 release.
- **Night session log (post-handoff pickup):**
  `docs/SESSION_LOG_2026-05-27_night-terminaltabs.md` — TerminalTabs
  wired into App.tsx, session schema v1→v2 migration, SplitLayout
  deleted, palette retargeted to tab actions; addendum at the bottom
  covers Commands-tab-mirror + H-1 fix.
- **TerminalTabs security review:**
  `docs/security-reviews/SECURITY_REVIEW_TERMINAL_TABS.md`.
- **Commands-tab-mirror security review:**
  `docs/security-reviews/SECURITY_REVIEW_COMMANDS_TAB.md`.
- **Chat-mode security review:**
  `docs/security-reviews/SECURITY_REVIEW_CHAT_MODE.md`.
- **Polish-pass security review (PR #21):**
  `docs/security-reviews/SECURITY_REVIEW_POLISH.md`.
- **Per-file LMM journals:** `journal/` mirrors `src/` paths.
- **Multi-provider design notes:** `docs/MULTI_PROVIDER_BRAINSTORM.md`.
- **Backlog:** `docs/BACKLOG.md`.
- **Verification report:** `docs/VERIFICATION_2026-05-27.md`.
- **Runtime verifier:** `scripts/runtime-verify.mjs` (writes
  `runtime-verify-summary.md` to repo root).
- **Audit + fix-pass detail:** PR #13 description on the testing repo.
