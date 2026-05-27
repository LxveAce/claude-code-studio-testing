# Claude Code Studio — Testing Repo STATUS

> **Last updated:** 2026-05-27 (R&D kickoff)
> **Branch this describes:** `master` (testing repo only — `LxveAce/claude-code-studio-testing`)
> **Latest session log:** [`SESSION_LOG_2026-05-27_rnd-kickoff.md`](./SESSION_LOG_2026-05-27_rnd-kickoff.md)

This is the always-current pickup doc. A fresh `git clone` + reading this file should
tell the next Claude session (on any machine) exactly where the work stands.

---

## Where we are

The official release (`LxveAce/claude-code-studio` master) shipped **v3.0.0** on
2026-05-26 with the multi-model catalog, file tree, cross-platform uninstall flow,
and the v3.0.0 release docs.

**As of this session (2026-05-27):**

- This testing repo is **now content-identical to release v3.0.0** at the start of
  the R&D push. We force-pushed testing/master = release HEAD (`d0af93a`) and then
  the **official repo was slimmed** of dev-only artifacts (journal/, security-reviews/,
  session logs, etc.) in commit `49b8fd9`. Testing keeps the full archive.
- This testing repo is the **active dev branch** going forward. R&D lands here in
  feature branches; once stable, features get promoted to the public repo via PR.

---

## In progress

R&D feature branches — each kicked off in this session, listed in execution order.
See `SESSION_LOG_2026-05-27_rnd-kickoff.md` for the full plan and rationale.

| Branch | Category | Status |
|---|---|---|
| `feature/tracking-infra` | Cat 3 — STATUS.md + SESSION_LOG + issues | **in flight (this commit)** |
| `feature/ui-foundations` | Cat 4 — themes + theme editor + resizable windows + state persistence | not started |
| `feature/multi-provider-plumbing` | Cat 5 — universal API key UI + safeStorage + PTY interceptor | not started |
| `feature/providers-gemini-aider-openrouter` | Cat 6 — provider abstraction + Gemini/Aider/OpenRouter wiring | not started |
| `feature/ollama-autostart` | Cat 7 — Ollama daemon autostart if local models registered | not started |
| `feature/installer-overhaul` | Cat 8 — modernized NSIS chrome + Ollama opt-in page | not started |

---

## Next up (priority order)

1. **Category 4 (UI foundations)** — themes + resizable windows + state persistence.
   Foundational; everything else builds on top.
2. **Category 5 (Multi-provider plumbing)** — universal API-key UI is a prereq for
   Category 6.
3. **Categories 6, 7, 8** can run in parallel feature branches once 4 + 5 are merged
   (file overlap is limited — themes/windows vs. providers/auth vs. installer touch
   different subtrees).
4. **Category 9 (Multi-provider brainstorm doc)** — written alongside Cat 6.

---

## Known issues / gotchas

- **node-pty patches:** `scripts/patch-node-pty.js` runs in postinstall. Building
  on a fresh machine requires the **Windows C++ Build Tools** (Visual Studio 2022
  Desktop Development with C++ workload + Windows SDK). Without these,
  `npm install` will fail at the node-pty rebuild step.
- **Vite externals:** `vite.main.config.ts` externalizes `node-pty` and
  `systeminformation`. Builder picks them up from `package.json` deps. Do not
  inline them — the bundled main process emits bare `require()`s for them.
- **NSIS Dev Mode:** Building Windows installers (`npm run dist:win`) requires
  Windows Developer Mode enabled (for symlink support during electron-builder
  packaging) **or** running as Administrator.
- **Compact controller hooks:** Already wired in
  `~/.claude/settings.json` for the user. The hooks shape was buggy at the start
  of this session — fixed (removed duplicate malformed entries from Stop /
  PreCompact / PostCompact arrays).

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
npm run dev

# 5. Build a Windows installer (optional — requires Dev Mode)
npm run dist:win
```

If `npm install` fails on node-pty rebuild:
1. Install Visual Studio 2022 with "Desktop development with C++" workload.
2. Install Windows 10/11 SDK (any recent version).
3. Re-run `npm install`.

If pulling a model via Ollama fails: the daemon may not be running yet — start
Ollama from its tray icon, or wait for the **Cat 7 (Ollama autostart)** feature
which auto-launches the daemon when local models are registered.

---

## Repo split (since 2026-05-27)

- **`claude-code-studio`** (public release) — slim. Contains only end-user
  facing files: source, CHANGELOG, README, LICENSE, install/release docs.
- **`claude-code-studio-testing`** (this repo) — full dev archive. Same source
  plus: `journal/` (LMM dev journals), `docs/security-reviews/` (21 phase
  audits), `docs/SESSION_LOG_*.md`, `docs/SHIPPING_CERTIFICATION.md`,
  `docs/FRESH_VM_TEST.md`, `docs/INSTALLER_REDESIGN.md`, plus any R&D
  features still in flight.

**Promotion path:** R&D feature → merged to `testing/master` → cherry-picked /
PRed to `claude-code-studio` master when ready to ship. Dev-only docs stay in
testing.

---

## Pointers

- **Plan for this R&D push:**
  `C:\Users\mmrla\.claude\plans\im-going-to-enable-lovely-cook.md` (Claude
  local — not in repo).
- **Per-file LMM journals:** `journal/` (mirrors `src/` paths).
- **Backlog:** `docs/BACKLOG.md` — v3.0.1+ ideas, kept current as we work.
- **Historical handoff:** `docs/HANDOFF.md` — frozen at v1.0, kept for trail.
- **Last v3 release notes:** `docs/RELEASE_NOTES_v3.0.0.md`.
- **Last v3 session log:** `docs/SESSION_LOG_2026-05-26_v3.0.0_release.md`.
