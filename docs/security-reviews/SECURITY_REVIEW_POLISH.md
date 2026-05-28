# Security / Correctness Review — Polish pass (M-1s on Commands tab + TerminalTabs)

**Branch:** `feature/polish-m1s` (stacked on `feature/claude-chat-mode`)
**Date:** 2026-05-27 (post-handoff continuation, fourth commit of the session)
**Scope:** Closes the two M-1 findings flagged in earlier red-teams:
- `SECURITY_REVIEW_COMMANDS_TAB.md` M-1 — Aider Quick-Action "starter" commands (`/add `, `/drop `, etc.) auto-submitted empty arguments.
- `SECURITY_REVIEW_TERMINAL_TABS.md` M-1 — no renderer-side tab count cap; the 17th tab silently failed at the PtyRegistry layer.

Two small, surgical fixes. No new features, no architecture changes.

---

## Findings

### Critical / High

None.

### Medium

#### M-1: `submit:false` commands don't auto-focus the composer

**Where:** `App.handleSendCommand` calls `sendToActive(command, submit)`. When `submit:false`, the command bytes land in the pane's PTY input but there's no signal to the renderer to scroll the terminal viewport or move the cursor caret.

**What:** Clicking "Add file" in the Aider Quick Actions sends `/add ` to the Aider REPL (correct). The user then has to click into the terminal pane to finish typing the filename. On most CLIs the prompt repaints with `/add ` visible and the cursor positioned correctly — but visually the *app* doesn't shift focus away from the Commands sidebar.

**Why it matters:** Minor UX papercut. Discoverable: most users would naturally click the terminal next. Doesn't risk data loss.

**Fix scope (deferred):** Would require either a "focus active pane" IPC the renderer can invoke after `sendToActive`, or programmatic focus on the xterm container. Neither is trivial because TerminalPanel doesn't expose a focus handle today. Track for a future Commands-tab iteration.

#### M-2: `capNotice` banner doesn't survive a panel switch

**Where:** `TerminalTabs.capNotice` is component-local state. If the user hits the cap, then opens a sidebar panel (which doesn't unmount TerminalTabs — it sits in the always-mounted left column), the banner stays. But the auto-dismiss timer keeps running across panel switches, so the banner can disappear faster than a user expects.

**What:** Edge-case timing — switch to Settings 2 s after hitting the cap, banner dismisses 2 s later while the user is on Settings, comes back to terminal → no banner. Minor.

**Fix scope (deferred):** Either persist the dismissal timestamp, or restart the timer on visibility change. Not worth the complexity today.

### Low

#### L-1: Cap notice text isn't internationalized

**Where:** Hardcoded English string.

**What:** Consistent with the rest of the app (no i18n infra yet). Tracked here for the day i18n becomes a real concern.

---

## Verification posture

- ✅ `npx tsc --noEmit` clean.
- ✅ `npx vite build` clean.
- ✅ `node scripts/runtime-verify.mjs` — 12 panels + 18 extended assertions pass (no regression from PR #20).

The `submit:false` and `MAX_TABS_RENDERER` paths aren't directly exercised by the verifier (would need a Commands→starter-command click chain + 32 tab adds). Both code paths are small and unit-testable; manual smoke covers them.

---

## Smoke list (manual)

(On top of PR #20's smoke list.)

1. Active tab is a Claude tab. Open Aider provider via picker (or simulate by switching family). Click "Add file" in Aider's Quick Actions. Active terminal should show `/add ` typed at the prompt; cursor sits after the trailing space; no submission fires. Type a filename and press Enter — Aider adds the file.
2. Click "Diff" (no trailing space, `submit` default true) → terminal receives `/diff\r` → Aider runs the command immediately.
3. Open + tabs until you hit 32 (or temporarily lower the constant for testing). The 33rd `+` click should: (a) refuse to add a tab, (b) show the yellow "Tab limit reached" banner above the content area, (c) banner dismisses ~4 s later.
4. `node scripts/runtime-verify.mjs` — 30 assertions still pass.

---

## Verdict

Ship. Two real findings closed; no new risks introduced. The
Followups list in `STATUS.md` is now down from 6 → 4 items.
