# LMM: src/renderer/components/models/ProviderSetupModal.tsx

> File: `src/renderer/components/models/ProviderSetupModal.tsx` · LOC: ~140 · Role: Shown when the user tries to launch a model whose CLI isn't installed; surfaces install command + link + retry.

## Phase 1: RAW

Cat 6 adds Gemini/Aider/OpenRouter to the catalog. None of those CLIs are bundled. The friendlier UX than "spawn → fail → show ENOENT in terminal" is "detect first, then either launch or show install instructions." This modal is the second half of that — first half is `provider-detect.ts` in main.

The shape is intentionally simple: one block showing the install command, a Copy button, an "Open install page" link, and a Retry button. Dismiss falls back to "user has to come back later." No "we'll install it for you" — auto-installing pip/npm packages on the user's machine is a footgun (which Python? Which venv? Which npm prefix?). Better to show the command and let the user run it where they want.

The "I installed it — retry" button is the load-bearing piece. It calls `providerAuth.detectGet(cli, force=true)` to invalidate the session cache and re-probe. If the user actually installed the CLI between opening this modal and clicking retry, the next click leads straight to launch. If they didn't (or the install went into a venv not on PATH), the modal stays open with updated detect info.

## Phase 2: NODES

### Node 1: One CLI per modal instance
Modal is keyed by `pendingSetup.model.command`. Why it matters: simple state, no list-of-missing-CLIs view.

### Node 2: Copy install hint button
Helper for the "I want to run this in another terminal" workflow. Why it matters: the user is typically already in a terminal (Claude Code Studio's terminal panel) — they might just paste it there and run.

### Node 3: openExternal for install page
Routed via `models.openExternal` to honor the existing allowlist (`github.com`, `huggingface.co`, etc.). Why it matters: GitHub install pages are on the allowlist; other URLs would need adding.

### Node 4: Retry re-probes with force=true
Calls back into main's `detectGet` to invalidate the session cache. Why it matters: lets the user actually get unblocked without restarting Studio.

### Node 5: Dismiss = "I'll deal with this later"
Clean exit. The user can re-trigger the modal by clicking Launch again. Why it matters: not coercive.

## Phase 3: REFLECT

### Core insight
**This modal is a setup-instructions page disguised as a modal.** It owns the "you need to do something outside the app to proceed" message without dictating how.

### Resolved tensions
- **Node 4 (retry probes) vs PATH-after-install**: a user who installs via `pip install --user` may land the binary in `~/.local/bin` which may or may not be on PATH at Electron startup. Retry probes against the same PATH that the eventual spawn would use, so if retry succeeds, launch succeeds. If retry fails repeatedly after the user "installed it," the diagnostic is "your shell's PATH and Electron's PATH differ — restart Studio." Documented in install-hint copy if it becomes a common confusion.

### Hidden assumptions
- Assumed: every detect result has a non-empty `installHint` and `installUrl`. Challenge: the underlying `PROVIDER_CLIS` map enforces this. If a future CLI lacks an install page, we'd need a fallback ("see your distro's package manager").

## Phase 4: SYNTHESIZE

### What this file should become
A stable, narrow modal. Possibly add a "Run command in terminal panel" button that pastes the install command into the active terminal pane (one fewer copy/paste step), but that's coupling to internals.

### Actionable items
- [ ] "Run in current terminal" button that sends the install command via `sendToActive`.
- [ ] Show the probe error reason if we have one (timeout vs not-found).

### Risks
- The install hint is provider-specific and could go stale as install commands evolve. Keep PROVIDER_CLIS map curated.
