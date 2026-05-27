# LMM: src/main/provider-detect.ts

> File: `src/main/provider-detect.ts` · LOC: ~160 · Role: Probes whether non-bundled provider CLIs (gemini, aider) are on PATH; caches result for the session.

## Phase 1: RAW

Cat 6 added Gemini / Aider / OpenRouter to the catalog, all of which require the user to install a CLI we don't bundle. Without detection, the catalog would offer "Launch" buttons that spawn → fail with `ENOENT` → user sees a useless terminal error. We want a friendlier path: detect the CLI isn't there, surface install instructions, retry after the user follows them.

The implementation is intentionally narrow: only the two CLIs we currently care about are in `PROVIDER_CLIS` (`gemini`, `aider`). Adding new providers means appending an entry to that map. The detection itself is a 4-second-bounded spawn of `<cli> --version` with stdout + stderr captured. Anything that prints + exits is "installed." `ENOENT` or timeout is "not installed."

Caching matters because the catalog probably remounts a lot (panel switch, refresh) and probing 2-4 CLIs per remount = several child processes for nothing. Session-cached probes resolve after the first call. Users who actually install a CLI mid-session can force a re-probe via the modal's "I installed it — retry" button (which calls `detectGet(cli, force=true)`).

I made the 4-second cap because some CLIs are slow to start under load (Python startup for aider in particular). A 1s cap would falsely report "not installed" too often on Windows.

## Phase 2: NODES

### Node 1: Closed PROVIDER_CLIS map
Only `gemini` and `aider` today. Why it matters: keeps the probe surface small + intentional. Each entry is hand-curated with its real install hint.

### Node 2: Session-level cache
`Map<cli, ProviderDetectResult>`. Invalidated only by `force=true`. Why it matters: per-mount probes were costing 4 child-process spawns; cache cuts that to one per session per CLI.

### Node 3: 4-second probe timeout
Hard kill if `--version` doesn't return. Why it matters: Aider's Python startup can hit 2s on a cold disk; 4s is generous without being pathological.

### Node 4: Non-zero exit still counts as "installed"
We capture stderr too. Some CLIs print "version: 1.2.3" to stderr (looking at you, npm). Why it matters: presence of the binary is what we care about, not exit code.

### Node 5: Single singleton via `providerDetect` export
Same pattern as Ollama / Auth / Theme services. Why it matters: one cache per process.

### Node 6: `installHint` + `installUrl` per CLI
Plumbed through ProviderSetupModal. Why it matters: the install command and the link should be in one place — adding a new CLI means one map entry, not separate edits across modal + main.

## Phase 3: REFLECT

### Core insight
**Detection is the gate between "show install instructions" and "launch."** A miss either way fails into the same recovery flow (modal → install → retry), so the cost of a wrong answer is small.

### Resolved tensions
- **Node 2 (cache) vs Node 6 (install hints in the result)**: cached results carry the hints from PROVIDER_CLIS. If the hint changes between releases, users see the old hint until they restart Claude Code Studio. Acceptable — install commands change rarely.
- **Node 3 (timeout) vs Node 4 (any exit counts)**: timeout returns null; non-zero exit with output returns the output. A CLI that hangs at startup is "not installed" from our perspective. Reasonable.

### Hidden assumptions
- Assumed: every CLI we'd want to detect responds to `--version`. Challenge: most do. If a future CLI uses `-V` only, we update its versionArgs.
- Assumed: PATH at app launch is what we'll spawn against. Challenge: Windows installs that modify PATH may need the user to restart the app. Documented behavior — "I installed it — retry" can also fall back to the user fully relaunching Studio.

## Phase 4: SYNTHESIZE

### What this file should become
A small, focused probe map. Grows by one entry per new CLI provider. Stays out of the catalog's business — catalog has model definitions, this file has CLI install state.

### Actionable items
- [ ] Surface the probe error reason in the modal (currently we just say "not installed" — spawn error vs PATH miss vs timeout would help diagnostics).
- [ ] Watch PATH for changes (Windows registry watch) so newly-installed CLIs auto-detect without a manual retry. Overkill for v1.

### Risks
- Aider's pip install may land in a venv that isn't on the parent shell's PATH. User installs it, retry says "still not installed" because the venv's bin isn't reachable. Documented in the install-hint copy.
- Windows users who install via `npm` need to relaunch any shell that pre-existed the install. The "retry" button in the modal won't help if Electron's PATH was forked at startup.
