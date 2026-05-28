# Session log — 2026-05-27 night (post-handoff pickup)

Continuation of the evening session (see
`SESSION_LOG_2026-05-27_evening.md`). The evening shipped chat-skin v2,
GPU routing, auth auto-detect, BitNet, the TerminalTabs scaffolding, and
v3.1.0. The user resumed on a different machine; this session picks up
item #1 from the evening's "Deferred" list — wiring
`TerminalTabs.tsx` into `App.tsx`.

The user explicitly asked to operate against the **testing repo only**
this session; nothing was pushed to `LxveAce/claude-code-studio`
(public release).

---

## Cross-machine pickup work (before code changes)

User started on a fresh machine. Setup actions:

- Confirmed `master` (origin/main repo) had one chore commit today:
  `49b8fd9 chore(repo): move dev artifacts to testing-only` — stripped
  journal/, security-reviews/, session logs, and one-off dev docs from
  the public repo. Testing retains the full archive.
- Created local branch `testing-master` tracking
  `remotes/testing/master`. All work happens here, push targets
  `testing` only.
- Refreshed `node_modules` against the v3.1.0 lockfile (`npm install` —
  124 added, 6 removed). Postinstall ran `patch-node-pty.js` cleanly.
- Cleaned stale build artifacts: `.vite/`, `out/`, `dist/`
  (`dist/win-unpacked/` was held open by 3 running CCS instances —
  stopped them first).
- Old installers in `Desktop\claude-code-studio-installers\` pruned
  per user choice: kept `Claude-Code-Studio-3.0.0-Windows.exe` (last
  shipped public stable) + new `Claude-Code-Studio-3.1.0-Windows.exe`;
  deleted 2.0.0 + 3.0.0-beta.1/2/3 (~270 MB freed).
- Pulled v3.1.0 Windows installer from the **draft** release on the
  testing repo. The Release CI created the release as `--draft` (per
  `.github/workflows/release.yml:123`) so it isn't visible via anonymous
  API. Authenticated `gh` and downloaded with
  `gh release download v3.1.0 --pattern "*Windows.exe"`. Release left
  draft (matches user's "testing only" stance).

---

## What got built this session

### TerminalTabs wired into App.tsx

LMM-walked the change before touching code (RAW → NODES → REFLECT →
SYNTHESIZE) — full analysis is in the new
`journal/src/renderer/components/terminal/TerminalTabs.tsx.lmm.md` and
the updated `journal/src/renderer/App.tsx.lmm.md`.

Specific file changes:

| File | Change |
|---|---|
| `src/shared/types.ts` | Dropped `SplitNode`, `SplitPaneNode`, `SplitContainerNode`. Added `PersistedTab`. `SessionState` now has `tabs: PersistedTab[]` + `activeTabId: string \| null` instead of `layout: SplitNode`. |
| `src/main/session-service.ts` | `STORE_VERSION = 2`. New `sanitizeTabs()` (max 32, id regex, dedupe, drops `profile !== 'claude'`). v1→v2 migration via `extractFirstPaneId()` — preserves the first pane's id so an alive PTY reattaches across hot-reload. Helper text references updated. |
| `src/renderer/App.tsx` | `[layout, activePaneId]` state replaced with `[tabs, activeTabId]`; `activePaneId` derived (`tabs.find(t => t.id === activeTabId)?.paneId`). New handlers: `handleNewClaudeTab`, `handleCloseActiveTab`, `handleFocusTab`, `handleResetTabs`. Old `handleSplit`/`handleClosePane`/`handleFocusNext`/`handleResetLayout`/`firstPaneId` removed. Catalog fetched via `models.list()` on hydrate (for the `+` profile picker). |
| `src/renderer/components/palette/CommandPalette.tsx` | Props renamed: `onSplit`/`onClosePane`/`onFocusNext`/`onFocusPrev`/`onResetLayout` → `onNewClaudeTab`/`onCloseTab`/`onFocusNextTab`/`onFocusPrevTab`/`onResetTabs`. Action labels migrated from "Split horizontal/vertical" / "Close pane" / "Focus next pane" / etc. → "New Claude tab" / "Close tab" / "Next tab" / "Previous tab" / "Reset tabs". `Panes` group renamed `Tabs`. |
| `src/renderer/components/terminal/TerminalTabs.tsx` | Race fix in scaffold (was Critical): `onTabsChange` prop changed to `React.Dispatch<React.SetStateAction<TerminalTab[]>>`; `addClaudeTab` / `addModelTab` / `closeTab` now use updater functions to survive concurrent gestures. See `SECURITY_REVIEW_TERMINAL_TABS.md` C-1. |
| `src/renderer/components/terminal/SplitLayout.tsx` | **Deleted.** |
| `src/main/pty-registry.ts` | Doc comment updated to reference TerminalTabs (was {@link SplitLayout}). |
| `journal/INDEX.md` | TerminalTabs entry added; counter 40 → 41. |
| `journal/src/renderer/components/terminal/TerminalTabs.tsx.lmm.md` | **New** — full LMM (RAW/NODES/REFLECT/SYNTHESIZE). |
| `journal/src/renderer/App.tsx.lmm.md` | Replaced — previous entry was from the 195-LOC era. Current entry reflects the ~680-LOC integration-hub reality. |
| `docs/security-reviews/SECURITY_REVIEW_TERMINAL_TABS.md` | **New** — red-team review. C-1 fixed in-commit; H-1 / M-1 / M-2 / M-3 / L-1 / L-2 deferred with rationale. |
| `docs/STATUS.md` | Item #1 moved from Deferred → What's live. Items #2, #3 renumbered. Pointers list updated. |

### Verification posture

- `npx tsc --noEmit` — clean (0 errors after one type fix on
  `focusedPid` narrowing).
- `npx vite build --config vite.renderer.config.ts` — clean (901
  modules, ~480 ms). Pre-existing chunk-size-warning is not a
  regression.
- No automated tests added — matches the repo's manual-QA posture for
  renderer work. Smoke list is in the security review.

### Red-team summary (full detail in SECURITY_REVIEW_TERMINAL_TABS.md)

- **Critical 1** — concurrent-mutation race in TerminalTabs scaffold.
  **Fixed in-commit.**
- **High 1** — `EmbeddedTerminal` lacks `registerSender` plumbing;
  snippet/palette text to model tabs is silently dropped. Deferred —
  bundled with the next Commands-tab-mirroring work (item #2 in
  STATUS Deferred).
- **Medium 1** — no renderer-side tab count cap. Deferred.
- **Medium 2** — `closeTab` focus-fallback still reads from closure
  `tabs`. Cosmetic only.
- **Medium 3** — CLI onboarding sends `/login` to active tab
  regardless of profile. Deferred.
- **Low 1** — `PlaceholderPanel.info` dead-code dict.
- **Low 2** — `HotkeyAction` enum lacks tab actions.

---

## Handoff checklist (for next session)

1. `git fetch testing && git checkout testing-master` (or `git pull` if
   the feature branch was already merged).
2. `cat docs/STATUS.md` for the current state — items #1 and #2 in
   Deferred are the next likely picks (Claude chat-mode profile;
   Commands-tab mirroring the active model).
3. Manual smoke list from `docs/security-reviews/SECURITY_REVIEW_TERMINAL_TABS.md`
   — particularly step 4 (open Claude tab during a model launch) to
   verify the C-1 fix in a real run.
4. If you pick up item #2 (Commands tab mirrors active model), it's a
   good moment to also fix H-1 (give `EmbeddedTerminal` a
   `registerSender` so snippet injection works on model tabs).

---

## Addendum — Commands-tab-mirror + H-1 fix (same session, second commit)

After PR #18 went out, the user said to continue. Picked up the
combined item: Commands sidebar mirrors active tab's profile + the
deferred H-1 fix from PR #18's red-team. Bundled because they're
tightly coupled — without H-1, the profile-aware Commands buttons
would no-op on model tabs.

Stacked branch: `feature/commands-tab-mirror` off
`feature/terminal-tabs-wiring`.

### What got built

| File | Change |
|---|---|
| `src/renderer/components/models/EmbeddedTerminal.tsx` | New `registerSender?` prop; register on PTY-attach effect; clear on unmount. Matches `TerminalPanel`'s pattern. Closes H-1. |
| `src/renderer/components/terminal/TerminalTabs.tsx` | Passes `registerSender` through to `EmbeddedTerminal`. |
| `src/renderer/components/commands/command-families.ts` | **New file.** `CommandFamily` discriminator (claude / ollama / aider / gemini / bitnet / unknown). `CommandFamilyConfig` per family with label + slash commands + quick commands + categories + shortcuts + optional `emptyMessage`. `deriveCommandFamily()` helper maps `profile + catalog → CommandFamily`. |
| `src/renderer/components/commands/CommandsPanel.tsx` | Accepts `family` prop; reads `COMMAND_FAMILIES[family]`. Header chip shows family label ("CLAUDE", "OLLAMA", …). `useEffect` collapses the expanded section on family change. Empty-state for families with no slash/shortcuts. |
| `src/renderer/components/commands/QuickCommands.tsx` | Accepts `commands` + `categories` + `emptyMessage` props instead of owning the data. `useEffect` self-heals `activeCategory` on family change. |
| `src/renderer/App.tsx` | Imports `deriveCommandFamily`; computes `activeCommandFamily` from active tab profile + catalog; threads through `RightPanel → CommandsPanel`. |
| `journal/src/renderer/components/commands/command-families.ts.lmm.md` | **New** LMM journal. |
| `journal/src/renderer/components/models/EmbeddedTerminal.tsx.lmm.md` | **New** LMM journal. |
| `journal/src/renderer/components/commands/CommandsPanel.tsx.lmm.md` | Addendum at the bottom covering the family-driven refactor. |
| `journal/src/renderer/components/commands/QuickCommands.tsx.lmm.md` | Addendum at the bottom covering data-driven props + self-healing category. |
| `journal/INDEX.md` | Added `auth/`, `chat-skin/`, `models/`, `settings/ThemeEditor` sections that prior sessions had created but not catalogued. Counter updated 41 → 47. |
| `docs/security-reviews/SECURITY_REVIEW_COMMANDS_TAB.md` | **New** red-team review. C-0 / H-1 fixed in-commit; M-1 (Aider starter auto-submit) + M-2 (model PTY StatusBar PID) + M-3 (instant tab swap) + 2 Lows deferred. |
| `docs/STATUS.md` | Item #2 moved from Deferred → What's live. H-1 carry-forward note replaced with M-1 + M-2. |

### Verification

- `npx tsc --noEmit` — clean.
- `npx vite build --config vite.renderer.config.ts` — clean (901
  modules, ~575 ms). Same pre-existing chunk-size warning.

### Red-team summary (full detail in SECURITY_REVIEW_COMMANDS_TAB.md)

- **Critical: none.**
- **H-1 (parent PR carry-over)** — `EmbeddedTerminal` lacked sender.
  **Fixed in-commit.**
- **Medium 1** — Aider Quick-Action "starter" commands (trailing
  space) auto-submit empty. Deferred — per-command `submit` flag.
- **Medium 2** — StatusBar PID is 0 for model tabs. Deferred —
  needs `EmbeddedTerminal` PID surfacing.
- **Medium 3** — Tab-switch instantly swaps the Commands panel
  content. Cosmetic; deferred fade animation.
- **Low 1** — `deriveCommandFamily` falls back to `'unknown'` for
  catalog entries with non-canonical `command`. Add per-entry
  `commandFamily` override only when a real case shows up.
- **Low 2** — Gemini slash-command list is sparse. Flesh out as
  Gemini gets used more.

### Handoff (revised)

The only remaining deferred item is the Claude "chat-mode" profile —
running `claude --output-format=stream-json --input-format=stream-json`
and routing the JSON events through a parser into the chat-skin
overlay. Now naturally a follow-up to the live tab model. ~90 min
estimated. After that, the original deferred list is fully drained
and the next session is a clean blank slate.

---

## Addendum 2 — Claude chat-mode profile (same session, third commit)

User said "continue" → picked up the last deferred item. Stacked
branch: `feature/claude-chat-mode` off `feature/commands-tab-mirror`.

### What got built

| File | Change |
|---|---|
| `src/renderer/components/chat-skin/json-stream-parser.ts` | **New file.** `JsonStreamParser` (line-delimited JSONL with partial-line buffer), `interpretClaudeChatEvent` (Claude SDK event shapes → `ClaudeChatAction` discriminated union), `encodeUserMessageJsonl` (outbound user-message wrap). Pure modules; forgiving on parse errors. |
| `src/main/model-catalog-seed.ts` | New `api.anthropic.claude-chat` entry — name "Claude (Chat)", command `claude`, args `['--print', '--input-format=stream-json', '--output-format=stream-json', '--verbose']`. Badge "Chat". |
| `src/renderer/components/commands/command-families.ts` | New `'claude-chat'` family with intentionally empty slash list + explanatory `emptyMessage`. `deriveCommandFamily` keys off exact profile id `'api.anthropic.claude-chat'`. |
| `src/renderer/components/chat-skin/ChatSkinOverlay.tsx` | Accepts `profile` prop. `JSON_STREAM_PROFILES` set + `isJsonStreamProfile` check route between text-mode (existing) and JSON-mode (new `ingestJsonChunk` + JSON-wrapped `send`). New `applyClaudeAction` module-scope helper applies parsed event actions to the message list. Echo-suppression bypassed in JSON mode. |
| `src/renderer/components/models/EmbeddedTerminal.tsx` | Accepts + passes `profile` to ChatSkinOverlay. |
| `src/renderer/components/terminal/TerminalTabs.tsx` | Passes `t.profile` through to EmbeddedTerminal. |
| `journal/src/renderer/components/chat-skin/json-stream-parser.ts.lmm.md` | **New** LMM journal. |
| `journal/src/renderer/components/chat-skin/ChatSkinOverlay.tsx.lmm.md` | Addendum covering the chat-mode JSON path. |
| `journal/INDEX.md` | Added json-stream-parser entry; counter 47 → 48. |
| `docs/security-reviews/SECURITY_REVIEW_CHAT_MODE.md` | **New** red-team review. 0 Critical, 1 High (flag-surface assumption — self-verifying on first run), 3 Medium + 2 Low deferred. |
| `docs/STATUS.md` | All 3 original deferred items now shipped — "Deferred" section now lists new followups from this session's red-teams. |

### Verification

- `npx tsc --noEmit` — clean.
- `npx vite build --config vite.renderer.config.ts` — clean (1.587 MB
  JS, +3 KB vs PR #19 — parser + interpreter + family entry).
- `node scripts/runtime-verify.mjs` — 12 panels + 18 extended
  assertions pass (no regression). Chat-mode itself isn't exercised
  by the verifier because launching it would require Claude CLI on
  the verifier host.

### What's NOT verified yet (carry forward)

- **End-to-end JSON I/O contract** with a real `claude` binary on the
  user's machine. The parser, interpreter, and renderer are unit-clean
  but the assumption that Claude accepts these flags + emits the
  assumed event shapes is empirical. First manual run will surface
  any mismatch as a parse-error bubble within seconds.
- **Tool-use / thinking blocks** — silently dropped by the
  `extractTextFromMessage` helper. M-1 in the chat-mode red-team.

### Handoff (final)

The original 3-item morning-handoff deferred list is **fully drained**.
The next session starts clean — see STATUS.md "Followups surfaced this
session" for the new (smaller) backlog from the three red-teams.

Three PRs sitting in the testing repo:
- PR #18 — TerminalTabs wiring + session schema v2 (foundation)
- PR #19 — Commands tab mirror + H-1 fix + verifier extension (stacked)
- PR #20 — Claude chat-mode profile (stacked)

Merge in order. Each subsequent base will auto-rebase to master after
the prior merges. No conflicts expected — each PR's file overlap with
the parent is additive in a different direction.

---

## Addendum 3 — Polish pass (PR #21, fourth commit of the session)

After PR #20 the user said "continue" again. Picked off two small
closeable items from the followups list: M-1 from
`SECURITY_REVIEW_COMMANDS_TAB.md` (Aider Quick-Action starter
auto-submit) and M-1 from `SECURITY_REVIEW_TERMINAL_TABS.md`
(renderer-side tab count cap).

Branch: `feature/polish-m1s` stacked on `feature/claude-chat-mode`.

### What got built

| File | Change |
|---|---|
| `command-families.ts` | `CommandDef` gains `submit?: boolean` (default true). Aider's trailing-space starters (`/add`, `/drop`, `/ask`, `/code`, `/architect`, `/run`) marked `submit:false`. Ollama's `/set system ` same. |
| `QuickCommands.tsx` | `onSendCommand` signature: `(command, submit?)`. Click handler passes `cmd.submit !== false`. |
| `CommandsPanel.tsx` | Same prop forwarding. |
| `App.tsx` | `handleSendCommand` accepts optional `submit` flag (default true) and forwards to `sendToActive`. `RightPanel` prop type updated. |
| `TerminalTabs.tsx` | `MAX_TABS_RENDERER = 32`. `addClaudeTab` + `addModelTab` short-circuit + set `capNotice` when at cap. Yellow banner above content area, 4s auto-dismiss. `role="status"` for SR. |
| `command-families.ts.lmm.md` | Addendum for submit flag. |
| `TerminalTabs.tsx.lmm.md` | Addendum for MAX_TABS cap. |
| `SECURITY_REVIEW_POLISH.md` | **New** small red-team — 0 Crit, 0 High, 2 Medium follow-ups (no auto-focus after submit:false; capNotice doesn't survive panel switch), 1 Low (i18n). |
| `STATUS.md` | Followups list 6 → 4. Pointers list adds the polish review. |

### Verification

- ✅ `npx tsc --noEmit` clean.
- ✅ `npx vite build` clean.
- ✅ `node scripts/runtime-verify.mjs` — 30 assertions pass.

### Final state of the night

Four PRs sitting in the testing repo, all stacked:
- PR #18 — foundation
- PR #19 — commands + H-1 + verifier
- PR #20 — chat-mode
- PR #21 — polish (this commit)

Followups list down to 4 items, all bounded:
1. Verify chat-mode flag surface against a real Claude binary
2. Tool-use / thinking renderer in chat skin
3. "Stop generation" button in chat skin
4. EmbeddedTerminal PID surfacing

---

## Addendum 4 — tool-use / tool-result / thinking renderer (PR #22, fifth commit)

User said "CONTINUE" (emphatic). Picked off the biggest remaining
followup — M-1 from `SECURITY_REVIEW_CHAT_MODE.md`. The chat-mode
JSON renderer was silently dropping `tool_use`, `tool_result`, and
`thinking` content blocks; now they each render as a distinct
in-timeline card.

Branch: `feature/tool-use-renderer` stacked on `feature/polish-m1s`.

### What got built

| File | Change |
|---|---|
| `json-stream-parser.ts` | `interpretClaudeChatEvent` now returns `ClaudeChatAction[]` (was single action). New action kinds: `add-tool-use`, `add-tool-result`, `add-thinking`. New helpers: `contentBlocksToActions`, `extractToolResultText`. `extractTextFromMessage` removed. |
| `ChatSkinOverlay.tsx` | `ChatMessage` gets optional `toolUse` / `toolResult` / `thinking` discriminators. New `isPlainTextMessage` predicate. `applyClaudeAction` extended with three new branches. `ingestJsonChunk` consumes the action-array shape. `MessageBubble` dispatches to new card components before falling through to text. |
| `ChatSkinOverlay.tsx` (new components) | `ToolUseCard` — purple "🔧 <name>" with click-to-expand JSON input. `ToolResultCard` — green "↩ Tool result" with line count + collapsible output. `ThinkingBlock` — muted dashed-border italic "💭 Thinking" with collapsible reasoning. All three use `aria-expanded` for screen readers. |
| `summarizeToolInput` helper | Pulls the most informative single field (`file_path`/`path`/`command`/`query`/etc.) for the collapsed preview. |
| `safeStringify` helper | JSON.stringify with try/catch. |
| `json-stream-parser.ts.lmm.md` | Addendum covering the action-array refactor + tool kinds. |
| `ChatSkinOverlay.tsx.lmm.md` | Addendum 2 covering tool card components + dispatch. |
| `SECURITY_REVIEW_TOOL_USE.md` | **New** red-team. 0 Critical/High. 3 Mediums deferred (pairing UI, summary field list, image rendering). 2 Lows (expanded pane size, no copy button). |
| `STATUS.md` | Followups list 4 → 3 (closed: tool-use renderer). |

### Verification

- ✅ `npx tsc --noEmit` clean.
- ✅ `npx vite build` clean.
- ✅ `node scripts/runtime-verify.mjs` — 30/30 still pass.
- ⚠ **Visual tool cards not exercised by harness** — requires a Claude
  session that actually emits tool_use blocks (`--allowedTools` set or
  MCP profile). The renderer code is pure-function + React state.

### Final state (revised)

5 PRs in flight on the testing repo:
- #18 — TerminalTabs wiring + session v2 (foundation)
- #19 — Commands tab mirror + H-1 fix + verifier extension
- #20 — Claude chat-mode profile + JSONL parser
- #21 — Polish (submit flag + tab cap)
- #22 — Tool-use / tool-result / thinking renderer (this commit)

Followups list 4 → 3:
1. Verify chat-mode flag surface against a real Claude binary
2. "Stop generation" button in chat skin
3. EmbeddedTerminal PID surfacing

All three are bounded; the next session has room to maneuver.

---

## Addendum 5 — EmbeddedTerminal PID surfacing (PR #23, sixth commit)

User said "please continue". Picked off the smallest remaining followup
— M-2 from `SECURITY_REVIEW_TERMINAL_TABS.md`. StatusBar PID footer
was showing 0 for any model tab because `pidByPane` in App.tsx was
only being populated by TerminalPanel's `onReady` event (which doesn't
fire for already-spawned PTYs that EmbeddedTerminal attaches to).

Branch: `feature/embedded-pid` stacked on `feature/tool-use-renderer`.

### What got built

| File | Change |
|---|---|
| `EmbeddedTerminal.tsx` | New `onPidChange?: (paneId, pid) => void` prop. The existing 1.5s `models.listRunning()` probe (originally for stale-popout detection) now also fires `onPidChange` with the harvested PID when the pane is found. Effect deps updated. |
| `TerminalTabs.tsx` | Passes `onPidChange` through to `EmbeddedTerminal` (App.tsx already routes the prop for TerminalPanel; now both paths use it). |
| `EmbeddedTerminal.tsx.lmm.md` | Addendum covering the change + the deferred T3 tension now resolved. |
| `STATUS.md` | Followups 3 → 2. Header updated for 6 stacked PRs. |

### Verification

- ✅ `npx tsc --noEmit` clean.
- ✅ `npx vite build` clean.
- ✅ `node scripts/runtime-verify.mjs` — 30/30 still pass.

End-to-end smoke (StatusBar shows real PID for a model tab) needs a
real model tab launched, which requires Ollama or another local CLI
installed. Renderer-side wiring is unit-clean.

### Why no separate red-team doc

Change is 4 lines of substantive code + 1 prop addition + 1 dep array
update. Below the threshold for a dedicated red-team file. The
`EmbeddedTerminal.tsx.lmm.md` addendum covers the design + tradeoffs.

### Final state (revised)

**6 PRs in flight** on the testing repo:
- #18 — TerminalTabs wiring + session v2
- #19 — Commands tab mirror + H-1 fix + verifier extension
- #20 — Claude chat-mode profile + JSONL parser
- #21 — Polish (submit flag + tab cap)
- #22 — Tool-use / tool-result / thinking renderer
- #23 — EmbeddedTerminal PID surfacing (this commit)

**Followups list 3 → 2:**
1. Verify chat-mode flag surface against a real Claude binary (self-verifying)
2. "Stop generation" button in chat skin

Of the original morning-handoff 3 deferred items + 6 surfaced
followups (= 9 total), **7 have shipped**. Remaining 2 are bounded:
one is a manual-test confirmation, the other is empirical UI that
needs real-app testing to design correctly.

---

## Addendum 6 — Stop button (PR #24, seventh commit)

User said "CONTINUE" (caps again). Picked off the smaller of the two
remaining followups — M-2 from `SECURITY_REVIEW_CHAT_MODE.md`. Chat-
mode now has a Stop pill that replaces the Send button while a
response is streaming.

Branch: `feature/stop-button` stacked on `feature/embedded-pid`.

### What got built

| File | Change |
|---|---|
| `ChatSkinOverlay.tsx` | New `stopGeneration` callback sends `\x03` (SIGINT char) via `terminal.sendInput`. Composer gets `canStop?` + `onStop?` props; renders red Stop pill (solid square icon) instead of Send circle when both are true. New `streamingTick` counter + `setTimeout` ensures `isStreaming` recomputes after `STREAMING_TAIL_MS + 50` so the button flips back when chunks stop arriving. Stop is **JSON-mode only** — text-mode CLIs handle their own Ctrl+C. |
| `ChatSkinOverlay.tsx.lmm.md` | Addendum 3 covering the Stop button, the `\x03` vs JSON-abort tradeoff, streaming-state detection mechanics. |
| `STATUS.md` | Followups 2 → 1; header updated for 7 stacked PRs. |

### Verification

- ✅ `npx tsc --noEmit` clean.
- ✅ `npx vite build` clean.
- ✅ `node scripts/runtime-verify.mjs` — 30/30 still pass.

### Why no separate red-team doc

Single-component additive change (Composer subprops + new callback in
ChatSkinOverlay). Below the threshold for a dedicated red-team file.
The journal addendum covers the empirical tradeoff (`\x03` vs JSON
abort) — if the user's real Claude binary treats `\x03` as
session-kill rather than abort-current-response, we swap to a
structured signal. That decision needs real-app data.

### Final state (revised again)

**7 PRs in flight** on the testing repo:
- #18 — TerminalTabs wiring + session v2
- #19 — Commands tab mirror + H-1 fix + verifier extension
- #20 — Claude chat-mode profile + JSONL parser
- #21 — Polish (submit flag + tab cap)
- #22 — Tool-use / tool-result / thinking renderer
- #23 — Model-tab PID surfacing
- #24 — Stop button in chat-mode (this commit)

**Followups list 2 → 1:** only the flag-surface H-1 left, and it's
truly self-verifying — the first launch of "Claude (Chat)" will
either show `_Claude JSON session ready._` (success) or a clear
parse-error bubble with the binary's actual usage message (failure
+ catalog args to iterate). No new code can probe this without an
actual `claude` binary on the verifier host.

**8 of 9 original followups shipped.** The 9th is a manual probe.
