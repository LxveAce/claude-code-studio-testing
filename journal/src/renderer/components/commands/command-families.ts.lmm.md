# LMM — src/renderer/components/commands/command-families.ts

> File: `src/renderer/components/commands/command-families.ts` · LOC: ~280 ·
> Role: Data + types for the per-profile command tables surfaced by the
> Commands sidebar. Owns one config object per CLI family (Claude /
> Ollama / Aider / Gemini / BitNet / unknown) plus a small derivation
> helper that maps `TerminalTab.profile` + model catalog → `CommandFamily`.

## RAW

Introduced alongside the Commands-tab-mirror feature. Before this, the
Commands sidebar was Claude-only: hardcoded `SLASH_COMMANDS` and
`QUICK_COMMANDS` literals lived inside `CommandsPanel.tsx`, and any
non-Claude tab silently showed Claude's slash list. After the
TerminalTabs wiring, the sidebar needed to know which CLI is active and
show its commands.

The file is structurally three things: (1) a `CommandFamilyConfig`
shape, (2) per-family configs (literal objects, one per CLI), and (3) a
`deriveCommandFamily()` function that turns a profile id +
`ModelDefinition[]` catalog into a family discriminator. The renderer
calls the helper once in `App.tsx` and threads the result through
`RightPanel` → `CommandsPanel` → `QuickCommands`.

Curation is deliberate: I included the slash commands and shortcuts
that users actually reach for, not every documented command. Ollama and
Aider got rich tables; Gemini got a minimal stub (the CLI is newer and
sparsely documented for slash commands); BitNet uses an `emptyMessage`
to surface the "this REPL has no slash commands" reality instead of
faking a list. Unknown gets a generic empty message and Ctrl+C / Ctrl+D.

Open questions:
- Should the catalog ship as JSON so the user can edit per-profile
  command sets without a rebuild? No — these are CLI conventions, not
  per-project preferences. Rebuild is the right place.
- Should we derive from the catalog entry's `provider` field instead of
  `command`? Both are valid; `command` is more deterministic (it's the
  binary that actually spawns) but `provider` covers display-name
  variants. The current helper falls back to `provider` only when
  `command` doesn't match a known key — best of both.

## NODES

1. **CommandFamily as discriminator** (lines 16-22): six values map to
   one config each. Adding a new CLI means: add to the union, add a
   config, extend `deriveCommandFamily`. Three coordinated edits, but
   bounded — there are 4-6 CLIs that matter.

2. **CommandFamilyConfig shape** (lines 37-55): same five fields per
   family — label, slash commands (grouped), quick commands
   (categorized), quick categories (pill order), shortcuts. Plus an
   optional `emptyMessage` for families with intentionally-empty
   sections (BitNet, unknown).

3. **Family configs are inline literals**: no transformations, no
   computed entries. Diff-friendly when adding a missing command.

4. **`deriveCommandFamily()` priority order** (lines 254-279):
   - `profile === 'claude'` first — the bundled CLI is a hard match,
     short-circuit.
   - Then look up the catalog entry and key off `command` field — most
     reliable (it's literally the binary).
   - Then fall back to `provider` substring matching for catalog
     entries where `command` is something generic (e.g., a wrapper
     script). Specifically catches "OpenRouter via Aider".
   - Default to `'unknown'` when nothing matches.

5. **No registry runtime dependency**: the file is pure data + a small
   pure function. `deriveCommandFamily` accepts a structurally-typed
   catalog array (`{ id, command?, provider? }[]`), so callers can pass
   the full `ModelDefinition[]` or any narrower shape without import
   gymnastics.

6. **Slash-command "starter" pattern**: some quick-commands like
   Aider's "Add file" have a trailing space (`/add `) so the user lands
   in the terminal mid-typing. Not all commands need this; left to the
   author of each entry.

7. **Keyboard shortcuts are CLI-REPL specific** — not OS-level chords
   the app binds. The note in the LMM for CommandsPanel about
   "shortcut list is documentation only" applies here too: we list what
   the underlying CLI binds.

### Tensions

- **T1: Per-model vs per-family.** Two Ollama models (`llama-3.1-8b`,
  `qwen-2.5-coder`) have identical slash commands but differ in
  capability. We group by family because the slash list is a property
  of the REPL, not the model weights. If a model adds its own commands
  (e.g., Llama Guard's `/guard`), this would need a per-model overlay
  — not today's problem.
- **T2: Aider's chat-mode commands vs slash commands.** Aider has
  `/code /ask /architect` AND a `--chat-mode` flag. We surface the
  slash commands since the tab profile is a launch-time selection;
  switching mid-conversation via slash is the documented way.
- **T3: Stub vs absent for Gemini.** Listing 3 commands when the CLI
  probably has 10+ is misleading. Resolved with a small stub for now
  + a note in the project STATUS to flesh out as we use Gemini more.

## REFLECT

**Core insight:** This file is a *data-first design*. Pulling the
catalog out of `CommandsPanel`'s JSX into a typed registry makes adding
a new CLI a one-file edit, not a refactor — and keeps the rendering
component pure (it takes config, renders config). The
`deriveCommandFamily` function is the sole derivation point; everywhere
else just consumes the resolved family.

**Resolved tensions:**
- **T1:** Family-level grouping is the right default. Per-model overlay
  is a follow-up that costs nothing to defer.
- **T2:** Slash commands win since they don't require a CLI restart.
- **T3:** Stubs are honest if labeled (`emptyMessage` makes the
  intent explicit for BitNet and unknown families).

**Hidden assumptions:**
- The CLI command name (`command` field of `ModelDefinition`) is stable
  across catalog edits. True today for ollama/aider/gemini/bitnet; if a
  catalog entry's `command` ever points to a wrapper script, the
  fallback to `provider` substring matching saves us.
- Slash commands sent via the palette / Quick Actions reach the CLI
  through `sendInput` + the explicit `\r` from `App.sendToActive`. CLIs
  accept slash commands as plain text + newline submit. Verified for
  Claude, Ollama, Aider; likely Gemini.

## SYNTHESIZE

**What this file does right:**
- Discriminator + config registry pattern keeps the renderer brain-dead
  simple.
- Inline literals are diff-friendly — adding `/foo` for Aider tomorrow
  is a one-line change.
- `deriveCommandFamily` has a defined precedence and a sane default.

**Actionable follow-ups:**
1. Flesh out Gemini config as the CLI matures (mark in STATUS).
2. Consider a per-model overlay if a specific weight-set adds its own
   slash commands (e.g., DeepSeek-R1's `/think on|off`).
3. When OpenRouter ships an MCP-style command set distinct from Aider,
   add a dedicated `'openrouter'` family.

**Risks:**
- Editing this file without updating the README/STATUS may mislead
  someone looking for "the canonical list of Aider commands" — the
  configs here are intentionally curated, not exhaustive. Worth a
  one-line doc comment next to each family's slash table if it grows.
- Catalog entries with funky `command` strings (e.g., shell wrappers)
  would fall to the `unknown` family despite being real CLIs. The
  `provider`-substring fallback mitigates but doesn't eliminate;
  ultimately a per-catalog-entry override would be the bullet-proof
  fix.

Related entries:
- [[CommandsPanel.tsx.lmm.md]] — the consumer that renders this config.
- [[QuickCommands.tsx.lmm.md]] — the sub-component for the Quick
  Actions tab.
- [[TerminalTabs.tsx.lmm.md]] — owns the active tab whose `profile`
  feeds `deriveCommandFamily`.

---

## Addendum — per-command `submit` flag (PR #21 polish pass)

Closes M-1 from `docs/security-reviews/SECURITY_REVIEW_COMMANDS_TAB.md`.

`CommandDef` gained an optional `submit?: boolean` (default `true`). When
`false`, clicking the quick action lands the command text in the active
pane *without* appending a submit char (CR / newline). Intended for
"starter" commands that need a user-supplied argument:
- Aider: `/add `, `/drop `, `/ask `, `/code `, `/architect `, `/run `
- Ollama: `/set system `

`QuickCommands.onSendCommand` was extended to take `(command, submit)`,
forwarded from `CommandsPanel` → `App.handleSendCommand` →
`sendToActive(command, submit)`. The default-true behavior is preserved
for every existing command, so this is a backward-compatible additive
change.

Trade-off accepted: `submit:false` commands no longer auto-focus the
composer for typing. The user has to click into the terminal pane and
finish typing themselves. Adding a "click → focus composer + cursor at
end" effect would require renderer→PTY signaling we don't have today;
filed for a future iteration if it becomes a real UX papercut.
