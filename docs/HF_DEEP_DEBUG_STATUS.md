# HF deep-debug status — pickup doc

This file is the always-current summary of the HF deep-debug
iteration cycle.  Pick it up from any machine that has the testing
repo cloned.  Last updated 2026-05-28.

---

## Where we are

Branch `feat/hf-deep-debug` carries a comprehensive empirical
rebuild of the Hugging Face integration plus surrounding QoL
improvements.  The work is NOT yet on `testing/master`; it's
checkpointed on a feature branch awaiting another round of user
feedback before merge.

| Layer | Status |
|---|---|
| Service refactor (`huggingface-service.ts`) | done — measured against real Hub API |
| Renderer (`HFPanel.tsx`) | done — every button verified |
| Direct GGUF download IPC (`hf:download`) | done — broadcasts progress events |
| Curated research list (18 entries) | done — all verified accessible |
| Sidebar tooltips + button hover descriptions | done — sidebar / LMM / Compact / Models / HF |
| CDP-driven test harnesses | done — 3 suites, 83 assertions total |

---

## How to keep iterating

1. Make sure the dev server is running with CDP:

   ```bash
   cd /c/Users/mmrla/claude-code-studio
   npm start -- -- --remote-debugging-port=9222
   ```

2. Run the audits:

   ```bash
   node scripts/hf-cdp-test.mjs       # 32 assertions: HF panel end-to-end
   node scripts/hf-button-audit.mjs   # 32 assertions: every HF button
   node scripts/lmm-audit.mjs         # 19 assertions: LMM panel
   ```

3. For new HF feature work, follow this loop:
   - Edit code → Vite hot-reloads renderer.
   - For main-process changes, kill electron + restart the dev
     command (Vite doesn't HMR main).
   - Run the relevant audit script.  All should stay at 100%.
   - Update `scripts/hf-button-audit.mjs` with new assertions for
     any new control you add.

4. When ready to ship, squash this branch's commits into clean
   per-area commits, open a PR against testing/master, merge, tag
   v4.0.2, CI builds installers, promote to public.

---

## What was measured (not assumed)

Four probe scripts (`scripts/hf-probe.mjs`, `-2`, `-3`, `-4`)
established the actual Hub API ground truth so the service stopped
guessing about field shapes.  Key findings, all empirically
verified:

- **Default expand list (returned without `additionalFields`):**
  `pipeline_tag → task`, `private`, `gated`, `downloads`,
  `lastModified → updatedAt`, `likes`.  Asking for any of these
  again triggers `expand[N] contains a duplicate value`.
- **`license` and `description` are NOT valid expand values.**  The
  API rejects both.  License lives in `cardData.license`; description
  isn't surfaced through this endpoint at all (use Web ↗ for that).
- **`gguf` expand is the authoritative GGUF signal.**  Returns
  `{ architecture, context_length, total, totalFileSize,
  chat_template, bos_token, eos_token }` — way better than
  tag-string matching.
- **`cardData` is where license + license_link + (sometimes)
  description actually live.**  Plus base_model, pipeline_tag,
  model_name.
- **`siblings` returns `{ rfilename }` only** (no size).  Use
  `listFiles` if you need per-file size data.

---

## Curated research models (18, verified accessible)

Ranked by monthly download adoption.  Repos that 404'd or required
auth during the survey were excluded.

The disclaimer + audit-log model in place is the only safety
surface — no filters or blocks, per the user's explicit "0
restrictions, end-user sandboxes" directive.

| Repo | ↓ / mo | arch | ctx | notes |
|---|---|---|---|---|
| bartowski/DeepSeek-R1-Distill-Qwen-32B-abliterated-GGUF | 39,875 | qwen2 | 131k | Best uncensored reasoner |
| bartowski/dolphin-2.9-llama3-8b-GGUF | 38,115 | llama | 8k | Well-tested |
| bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF | 29,097 | llama | 131k | Smallest serious entry |
| TheBloke/dolphin-2.5-mixtral-8x7b-GGUF | 17,799 | mixtral | 32k | Apache 2.0 |
| TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF | 14,672 | llama | 2k | Baseline |
| bartowski/Hermes-3-Llama-3.1-8B-GGUF | 8,965 | llama | — | Neutral alignment |
| TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF | 3,357 | llama | 2k | Smaller baseline |
| cognitivecomputations/dolphin-2.9.4-llama3.1-8b-gguf | 2,572 | llama | 131k | Official Dolphin team |
| bartowski/Hermes-3-Llama-3.1-70B-GGUF | 1,352 | llama | — | Larger Hermes |
| failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF | 1,091 | llama | 8k | failspy abliteration |
| mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF | 957 | llama | 131k | i-matrix quant |
| failspy/Phi-3-mini-128k-instruct-abliterated-v3-GGUF | 556 | phi3 | 131k | MIT-licensed |
| failspy/Llama-3-70B-Instruct-abliterated-GGUF | 532 | llama | 8k | Large abliterated |
| mradermacher/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF | 527 | llama | 131k | Lexi V2 |
| mradermacher/dolphin-2.7-mixtral-8x7b-GGUF | 340 | mixtral | 32k | Earlier mixtral dolphin |
| mlabonne/NeuralDaredevil-8B-abliterated-GGUF | 272 | llama | 8k | DPO-refined |
| mradermacher/DeepSeek-R1-Distill-Llama-70B-abliterated-GGUF | 168 | llama | 131k | Largest reasoner |
| mlabonne/Daredevil-8B-abliterated-GGUF | 81 | llama | 8k | Earlier Daredevil |

---

## Key new behaviour

### Hardware-aware recommended quant
`pickRecommendedVariant(variants, maxVramGB)` picks the LARGEST quant
whose 1.25× file size fits the user's GPU.  When hardware is
unknown, falls back to community defaults: Q4_K_M, then Q5_K_M,
then "anything but Q2 / IQ1", then the first variant.

### Hardware FitBadge per variant
Each GGUF variant row carries a colour-coded badge based on the
user's auto-detected VRAM + RAM:

- green `✓ fits GPU` — comfortable headroom
- yellow `~ tight` — fits but no context cache room
- orange `◆ CPU only` — won't fit GPU but RAM holds it
- red `✗ no fit` — too large

### Direct download IPC
`window.electronAPI.hf.download(repoId, fileName)` streams a single
file via Electron's `net` module to `<cache>/models--<org>--<name>/
blobs/<file>` (HF hub layout).  Throttled (~10/s) progress events
broadcast over `hf:download-progress` to every window.

### Sort dropdown
Browse tab now supports sorting by downloads / likes / trending /
recently updated / recently created.  Maps to the Hub API's `sort`
query param.

### Empty-state with clickable suggestions
Zero-result Browse shows 6 example queries (`llama gguf`, `qwen 2.5`,
`mistral 7b`, `phi 3`, `embedding`, `code llama`) as clickable chips.
Also offers a "clear the GGUF Only filter" link when applicable.

### Cached tab reframed
Distinguishes Catalyst's direct-download cache from Ollama's
separate cache.  Adds "Open folder ↗" button to browse in OS
explorer.  Shows total size + repo count summary.

### Sidebar tooltips with descriptions
Hovering any sidebar icon shows label + a short description of what
the panel does.

---

## Failing edge cases (none — clean)

- 32 / 32 HF CDP smoke assertions pass.
- 32 / 32 HF button-audit assertions pass.
- 19 / 19 LMM audit assertions pass.
- 18 / 18 curated research repos resolve.
- Zero renderer exceptions, zero `console.error` during audits.

---

## Files added this cycle

```
journal/HF_DEEP_DEBUG_2026-05-28.lmm.md   — full LMM walk
docs/HF_DEEP_DEBUG_STATUS.md              — this file
scripts/hf-probe.mjs                      — measure SDK default expand
scripts/hf-probe-2.mjs                    — cardData / siblings / gguf shape
scripts/hf-probe-3.mjs                    — verify curated list 1
scripts/hf-probe-4.mjs                    — broader uncensored survey
scripts/hf-research-survey.mjs            — final 30-candidate ranking
scripts/hf-cdp-test.mjs                   — 32-assertion CDP smoke
scripts/hf-cdp-debug.mjs                  — one-shot diagnostic dump
scripts/hf-download-test.mjs              — IPC stream verification
scripts/hf-button-audit.mjs               — every-button audit
scripts/lmm-audit.mjs                     — LMM panel audit
scripts/test-quant-regex.mjs              — 20-case quant regex test
scripts/inspect-files.mjs                 — sanity-check real filenames
```

---

## What's deferred

Per-tab tooltip additions on terminal tabs (+, ▼, popout, ×), Settings
sections, and the auth / sync / GitHub panels.  Add them as their
own audit-and-fix passes when the user requests them.
