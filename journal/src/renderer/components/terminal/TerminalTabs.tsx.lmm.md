# LMM — src/renderer/components/terminal/TerminalTabs.tsx

> File: `src/renderer/components/terminal/TerminalTabs.tsx` · LOC: ~715 ·
> Role: Windows-Terminal-style tab strip + content host that replaces the
> SplitLayout pane tree. Owns no state itself — the tab list and active id
> are passed in from App.tsx so session persistence has one source of truth.

## RAW

The file was scaffolded earlier in the day (PR #17) but not wired in until
this session — App.tsx still rendered `<SplitLayout>` on top of the v1
session schema. The component is structurally three things glued together:
(1) a horizontal strip of `Tab` cells with status dot / close / popout
buttons, (2) a `NewTabButtons` cluster (`+` for a Claude tab, `▼` for a
profile picker), and (3) a content area that switches between
`TerminalPanel` (Claude) and `EmbeddedTerminal` (any other model). The
content area keeps every tab mounted with `display:none` on the inactive
ones so the PTY state and xterm scrollback survive a tab switch, mirroring
SplitLayout's invariant that "TerminalPanel unmount does NOT kill the PTY."

The component takes `tabs / activeTabId / onTabsChange / onActiveChange`
as a controlled pair plus the same `onPidChange / registerSender` props
the old `SplitLayout` had, so palette/snippet text injection and the
StatusBar PID readout keep working unchanged. It also takes `catalog`
(`ModelDefinition[]`) — used only by the inline `ProfilePicker` dropdown
when the user hits `▼`.

The trickier moves are: `addModelTab` inserts a `ready: false` placeholder
tab while `models.launch(modelId)` is in flight, and `popoutTab`
deliberately keeps the source tab alive after popout (the popout
BrowserWindow attaches to the same paneId; closing the popout doesn't kill
the PTY). Closing a tab calls `terminal.kill(paneId)` explicitly — that's
the only path where a paneId's PTY is actually killed, matching App.tsx's
contract.

Open questions:
- The `+` button creates a Claude tab; the `▼` picker creates a model tab.
  Both flow through the same `setTabs` callback. Is there a reason the
  picker doesn't include Claude as an option? Yes — line 476 excludes
  `api.anthropic.claude` since `+` is the canonical Claude entry point.
- `EmbeddedTerminal` receives `paneId` but not `registerSender`. Snippets
  / palette text-injection therefore only works on Claude tabs; model
  tabs silently swallow injected text. Deferred fix.

## NODES

1. **Stateless ownership** (lines 55-67): `useState` only for picker UI
   transient state (`pickerOpen`, `pickerQuery`, `closingId`). Tab list is
   fully external — App.tsx owns it and the session persistence layer
   serializes it.

2. **PaneId conventions** (lines 70-83): Claude tabs construct
   `paneId = p_<id-suffix>`. Model tabs leave `paneId` empty in the
   placeholder and assign it from `models.launch()`'s return. Both
   conventions match `MAX_ID_LEN = 64` + `^[A-Za-z0-9_\-:]+$`.

3. **Placeholder-then-confirm pattern for model tabs** (lines 85-117):
   Insert an unready placeholder immediately so the UI doesn't freeze
   during the seconds-long Ollama / Aider spawn. Replace with the
   confirmed paneId on success; remove on failure.

4. **All-tabs-mounted invariant** (lines 224-258): inactive tabs use
   `display: none` (not unmounted). This is what keeps the PTY connection
   and xterm scrollback alive across tab switches. Cheap because xterm
   doesn't redraw while hidden.

5. **Profile-driven content switch** (lines 244-255): `t.profile ===
   'claude'` → `TerminalPanel`; otherwise → `EmbeddedTerminal`. Two
   different PTY hosts because Claude needs the full `registerSender` /
   `onPidChange` wiring and EmbeddedTerminal is the simpler model-pane
   attach.

6. **Popout-without-orphan** (lines 141-154): popout opens a separate
   BrowserWindow on the SAME paneId; if we removed the tab on popout, the
   PTY would be orphaned (no UI way to send input). The comment is
   explicit about this trade-off.

7. **Empty state** (lines 211-223): when `tabs.length === 0`, the area
   renders an inline "Open a Claude tab" CTA. App's `handleCloseActiveTab`
   refuses to close the last tab, so this state only arises if external
   state is corrupt or `handleResetTabs` returns nothing — defensive UI.

8. **Profile picker** (lines 434-583): self-contained dropdown with
   search filter, escape-to-close, click-outside-to-close. Anthropic is
   intentionally pinned at the top and excluded from the search list to
   reinforce that `+` is the canonical Claude entry.

9. **Inline styles** (lines 669-713): same convention as the rest of the
   renderer. No CSS classes; CSS variables for theme tokens only.

### Tensions

- **T1: Tab as transient runtime object vs. persisted record.** The
  in-memory shape has `ready: boolean`; the persisted shape doesn't.
  Mixing them risks `ready: undefined` leaking through. Resolved by
  `PersistedTab` (in `shared/types.ts`) being a strict subset.
- **T2: Model tab persistence.** Persisting model tabs would let users
  pick up exactly where they left off, but silently triggering Ollama
  pulls or GPU loads on hydrate would surprise them. Resolved: only
  Claude tabs are persisted (`SessionService.sanitizeTabs` strips
  non-Claude profiles before write).
- **T3: Snippet/palette injection only works on Claude tabs.** Because
  EmbeddedTerminal doesn't call `registerSender`. Acceptable in this
  iteration — model PTYs are LLM REPLs and the "send a snippet"
  semantics differ. Listed as a follow-up.

## REFLECT

**Core insight:** The component is a *view* over an externally-owned tab
list. The hard work — session persistence, palette wiring, sender
registry — is App.tsx's responsibility. TerminalTabs's job is purely to
mediate user gestures (click tab, click `+`, click `×`, click `↗`) into
state-mutation callbacks plus render the right PTY host per tab profile.
Keeping it stateless is what makes the wiring trivial.

**Resolved tensions:**
- **T1:** The persisted `PersistedTab` shape in `shared/types.ts` is the
  contract between renderer and main; the runtime `TerminalTab` extends
  it with `ready` (always `true` after hydration since persisted tabs
  represent reattach-able PTYs). One-way enrichment, no leak risk.
- **T2:** `SessionService.sanitizeTabs` filters `profile !== 'claude'`
  defensively on both read and write paths — even if a future bug saves
  a model tab, the sanitizer drops it before the next hydrate.
- **T3:** Deferred as item #3 in STATUS.md "Deferred" (Commands tab
  mirrors active model) — that work will also be a natural place to
  give EmbeddedTerminal a `registerSender` plumbing.

**Hidden assumptions:**
- `models.launch(modelId)` returns a paneId compatible with `MAX_ID_LEN`
  + regex. Main controls the format, so this is enforced upstream.
- `terminal.kill(paneId)` is idempotent — calling it on a dead PTY is a
  no-op. Confirmed in the PtyRegistry comment.
- `models.popout(paneId, label)` creates a window that loads the App
  with `?popout=<paneId>&label=<name>`; App's popout short-circuit
  renders only `<PopoutView>` so the tab strip isn't duplicated.

## SYNTHESIZE

**What this file does right:**
- Stateless ownership keeps the surface small and the test matrix flat.
- The `display: none`-for-inactive pattern reuses SplitLayout's PTY
  preservation invariant without re-implementing it.
- The placeholder-then-confirm pattern hides multi-second spawn latency
  without lying to the user (the tab shows "Launching X…" instead of
  appearing to hang).

**Actionable follow-ups:**
1. Give `EmbeddedTerminal` a `registerSender` prop so snippet/palette
   text injection works on model tabs (ties into the Commands-tab
   mirroring task already in STATUS.md "Deferred").
2. Consider a `Ctrl+Shift+T` hotkey binding for "new Claude tab" — the
   `+` button title already advertises that chord, but no binding exists
   in `HotkeyAction`. (Would require extending the `HotkeyAction` enum
   and wiring through `dispatchAction`.)
3. If the persisted tab list ever exceeds the visible width, the strip
   scrolls horizontally (`overflowX: 'auto'`). Confirm muscle memory
   like middle-click-to-close works — currently only the `×` button
   closes.

**Risks:**
- Any future change that unmounts inactive tabs would silently break the
  PTY-preservation invariant; the inline comment on line 226 calls this
  out so reviewers don't optimize it away.
- Excluding Anthropic from the picker (line 476) means renaming the
  catalog entry would silently break the exclusion. Pin to the exact id
  rather than the display name — already correct.

Related entries:
- [[TerminalPanel.tsx.lmm.md]] — the per-pane xterm host this file
  embeds; its `useEffect([paneId])` is the line that makes the
  "swap a tab, keep the PTY" invariant work.
- [[App.tsx.lmm.md]] — owner of the tab list and the session-persistence
  glue.

---

## Addendum — `MAX_TABS_RENDERER` cap (PR #21 polish pass)

Closes M-1 from `docs/security-reviews/SECURITY_REVIEW_TERMINAL_TABS.md`.

Added a renderer-side hard cap of 32 tabs matching
`SessionService.MAX_TABS`. `addClaudeTab` and `addModelTab` check
`tabs.length >= MAX_TABS_RENDERER` and short-circuit with a yellow
`capNotice` banner ("Tab limit reached (32). Close a tab first.") that
auto-dismisses after 4 s. Prior behavior would silently append a tab
that PtyRegistry then refused to spawn — manifested as a dead-looking
terminal for Claude or an `alert()` for models. New behavior is
consistent and informative for both code paths.

The banner sits between the tab strip and the content area — high enough
in the visual hierarchy to be noticed, separate enough that it doesn't
collide with tab gestures. `role="status"` for screen readers.
