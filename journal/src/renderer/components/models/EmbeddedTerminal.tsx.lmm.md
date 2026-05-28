# LMM — src/renderer/components/models/EmbeddedTerminal.tsx

> File: `src/renderer/components/models/EmbeddedTerminal.tsx` · LOC: ~200 ·
> Role: Inline xterm.js view that **attaches** to an already-spawned model
> PTY (paneId created by MODELS_LAUNCH). Used by the Models panel's
> "Running" list, by TerminalTabs for non-Claude tabs, and by PopoutView.

## RAW

Sister component to `TerminalPanel`, with one key difference: it does
**not** spawn the PTY — it attaches to one that MODELS_LAUNCH already
created. That distinction drives a smaller surface area:

- No `cwd` prop (the model PTY was launched with the catalog entry's
  command + args; cwd is decided main-side from git state).
- No `onPidChange` (the pid was assigned at launch and is already
  tracked by the Models panel via `models:listRunning`).
- A "PTY not found" probe runs 1.5 s after mount via
  `models.listRunning()` — if the paneId isn't in the live list (stale
  popout link, model exited while away), write a friendly placeholder
  to xterm instead of leaving the user staring at a blank pane.

The chat-skin toggle (lines 36-43, 164-189) mirrors `TerminalPanel`'s
overlay — same `skin-prefs` keyed by paneId, same visibility-swap
pattern, same `ChatSkinOverlay` mounted underneath. Effect: a popout
window or a model tab can switch to chat skin and the preference is
remembered per paneId across both surfaces.

The recent (this commit) addition is `registerSender` — wires the embed
into App.tsx's `sendersRef` so the Commands sidebar / palette /
snippets can inject text into the model PTY. Until this, those features
silently no-op'd for non-Claude tabs (the H-1 finding in the
TerminalTabs red-team).

## NODES

1. **Attach, don't spawn** (lines 8-22 of header doc): the entire
   contract. Any future change that calls `terminal.spawn(paneId,...)`
   from here would duplicate work `models.launch()` already did.

2. **`registerSender` registration** (lines 125-128): on mount, register
   a function that calls `terminal.sendInput(paneId, data)`. Same
   function `term.onData` uses internally for the user's keystrokes, so
   external injection and direct typing share one IPC path.

3. **`registerSender` cleanup** (line 138): on unmount, `registerSender?.(paneId, null)`
   removes the entry from App's `sendersRef`. Without this, switching
   away from a model tab would leave a stale function in the registry
   that, if invoked later, would call `sendInput` on a dead PTY.

4. **PTY-not-found probe** (lines 109-121): 1.5 s timeout, single shot.
   Fail-soft: if `models.listRunning()` is unavailable (IPC missing in
   a future build) the warning is skipped silently. The probe's value
   is for stale-popout scenarios — popout windows can survive longer
   than their PTY.

5. **`fitIfChanged()` optimization** (lines 46-61): same pattern as
   TerminalPanel — `proposeDimensions` first, compare to current
   `term.cols/rows`, only fit if different. Prevents the
   ResizeObserver feedback loop.

6. **Chat-skin parity** (lines 36-43, 164-189): the skin-prefs key is
   paneId — so the same paneId surfaces the same skin state whether
   rendered by TerminalPanel, EmbeddedTerminal, or PopoutView. One
   source of truth: localStorage.

7. **No PID reported** (deliberate): App.tsx's `pidByPane` is fed only
   by TerminalPanel's `onReady` event. EmbeddedTerminal doesn't
   subscribe to `onReady` (no race-free way to do so after-the-fact;
   the PID is known to main at launch time). Consequence: the StatusBar
   shows PID 0 when a model tab is active. Cosmetic for now.

8. **Theme is hardcoded** (lines 67-73) — same Claude-purple palette
   as TerminalPanel, not theme-token-driven. Inherited limitation; not
   addressed in this change.

### Tensions

- **T1: Symmetry with TerminalPanel vs lightness for attach-only.**
  TerminalPanel has spawn logic, onReady handling, exit-restart UX,
  and PID tracking. EmbeddedTerminal omits all of those because it
  attaches. The asymmetry is real and intentional — but it means any
  new "every-pane" behavior must be added to both files.
- **T2: registerSender lifetime races.** The sender is registered when
  the embed mounts and cleared when it unmounts. If a model tab is
  switched away (display:none in TerminalTabs) the embed STAYS mounted
  — registration survives. Tab is closed (`closeTab` calls
  `terminal.kill`) → unmount → registration cleared. Order matters:
  kill PTY, THEN unmount, so a late sendInput between kill and unmount
  could hit a dead PTY. Main-side `sendInput` on an unknown paneId is
  a no-op, so the race is benign.
- **T3: StatusBar PID parity.** TerminalPanel populates `pidByPane`;
  this file doesn't. For users who flip to model tabs and look at the
  PID footer, this is a visible-but-cosmetic regression vs. Claude
  tabs. Could be fixed by extending `models.listRunning()` to push
  PID change events, or by reading `pidByPane[paneId]` from a
  Models-panel-maintained store. Deferred.

## REFLECT

**Core insight:** EmbeddedTerminal is the *passive* sibling of
TerminalPanel — it doesn't own a lifecycle, it borrows one. That makes
adding behavior like `registerSender` cheap (just wire on mount, clean
on unmount) but also means every "feature parity with Claude tabs"
request needs to think about whether the data is available without
spawning.

**Resolved tensions:**
- **T1:** Accept the asymmetry. Document the contract in the header
  comment so future readers know which file owns what.
- **T2:** Order of operations in `closeTab` (kill, then state update,
  then unmount) is already correct. Main-side defensive `sendInput`
  handling means the race is harmless.
- **T3:** Park as a "polish" item; the StatusBar PID display is
  user-facing but not critical. If the work to expose PID via
  `models.listRunning()` push events is small, do it in the same PR
  as the next Models-panel iteration.

**Hidden assumptions:**
- `terminal.sendInput(paneId, data)` on a dead PTY is a no-op (verified
  by reading `PtyRegistry.sendInput` — yes, early-return when the
  pane is unknown).
- `registerSender` is idempotent: re-registering for the same paneId
  overwrites cleanly (App's implementation is `sendersRef.current[paneId] = send`).

## SYNTHESIZE

**What this file does right:**
- Tight contract: attach-only. No spawn paths to maintain.
- Mirrors TerminalPanel's chat-skin + fit patterns so users see a
  consistent terminal experience regardless of which surface hosts it.
- The new `registerSender` plumbing closes H-1 from the TerminalTabs
  red-team without ballooning the component's responsibility.

**Actionable follow-ups:**
1. Expose PID for model panes (via `models.listRunning()` push events
   or a Models-panel-maintained store) so the StatusBar matches Claude
   tab behavior.
2. Consider extracting the shared "fit + chat-skin + theme" code into a
   `useXterm()` hook so TerminalPanel and EmbeddedTerminal stop
   diverging on cosmetic concerns.

**Risks:**
- Adding new lifecycle subscriptions (onReady, onResize-from-main, etc.)
  needs both this file AND TerminalPanel updated, or behavior will
  fork between Claude and model tabs.
- The 1.5 s "not found" probe is a heuristic — a slow `listRunning()`
  could miss a freshly-spawned PTY. Today's race window is wide enough
  to make the false-positive rate effectively zero, but if launch
  latency drops below ~500ms, revisit.

Related:
- [[TerminalPanel.tsx.lmm.md]] — the spawning sibling.
- [[TerminalTabs.tsx.lmm.md]] — the parent that now passes
  `registerSender` through (H-1 fix).
- [[command-families.ts.lmm.md]] — the new data registry whose Commands
  the registered sender can finally reach.

---

## Addendum — PID surfacing for model tabs (PR #23)

Closes M-2 from `SECURITY_REVIEW_TERMINAL_TABS.md`. Adds an
`onPidChange?` prop matching TerminalPanel's. The existing 1.5s
`models.listRunning()` probe (originally only used to detect stale
popout windows) now also harvests the PID and fires the callback
when the pane is found.

**Behavior:**
- StatusBar PID footer was previously 0 for any model tab — `pidByPane`
  in App.tsx was only populated by TerminalPanel's `onReady` event,
  which doesn't fire for already-spawned PTYs that EmbeddedTerminal
  attaches to.
- After this change: 1.5s after mount, the embed calls
  `models.listRunning()`, finds its own paneId in the result, and
  fires `onPidChange(paneId, found.pid)` if the PID is > 0.
- TerminalTabs threads the prop from App.tsx (which already has the
  shared `pidByPane` reducer) to EmbeddedTerminal.

**Tradeoffs:**
- 1.5s delay before the PID shows in the footer — same delay as the
  "PTY not found" probe; piggybacks on the existing call to keep the
  code minimal. Could split into a faster (~300ms) PID probe + the
  slower not-found probe; not worth the complexity for a footer.
- PID is never refreshed mid-session. If a model PTY were ever
  restarted by main (it isn't today), the footer would be stale.
- No cleanup on unmount — `pidByPane[paneId]` survives tab close,
  matching TerminalPanel's behavior (consistent leak, not a new one).

**T3 (in the NODES) resolved.** The "StatusBar PID parity" deferred
item is now closed.
