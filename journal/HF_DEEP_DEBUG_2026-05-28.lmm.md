# LMM cycle — Hugging Face integration deep debug

> 2026-05-28 evening. User authorized open-ended local iteration:
> "make this thing good." Catalyst UI install closed; working off
> `feat/hf-deep-debug` branch; dev mode + CDP will drive the loop.

---

## Phase 1 — RAW

What I know is broken or thin in the HF integration, from screenshots + my own reads:

- `additionalFields` collisions with the SDK's default expand list
  - `pipeline_tag` (v4.0.1 expand[N] dup)
  - `description` (v4.0.2 expand[7] invalid — `description` isn't a
    valid expand value at all, only the list shown in the API's
    error message is)
  - We've been guessing what overlaps with defaults instead of
    measuring.
- `GGUF Only` filter relied on `tags` which I dropped, then added
  back — there's no probe that confirms the value actually arrives
  on every result; some uploaders may omit the `gguf` tag even when
  the repo contains GGUF files.
- Research tab returned zero results because of the GGUF dependency
  + zero curated fallback. Curated list now added but never tested
  against the actual Import → Ollama path.
- Details panel: clicking it triggered the modelInfo expand[7]
  rejection; user wanted in-UI flow + explicit Web button.
- Description: we requested it as expand but the API doesn't return
  README bodies — wrong endpoint for that. cardData would surface
  the YAML frontmatter, not the prose description.
- Model name in card was a web link with no in-UI default — fixed
  in the pending checkpoint.
- "Direct download in the UI" — the Import to Ollama path actually
  triggers a network pull via `ollama serve`. The user might mean
  download THE GGUF FILE locally (to the hf-cache directory) without
  Ollama in the loop. That's `hf.download` which we never built.
- Cached tab: shows the `~/.cache/huggingface/hub` path, but if
  Ollama is the one downloading, nothing lands there — Ollama uses
  its own cache. Probable disconnect.
- Network errors: catch + rethrow with a string, but no retry, no
  rate-limit handling, no timeout.
- Pop-out window for HF: never implemented; HF panel only exists in
  main window. Unclear if that's a regression.
- Browse list pagination: only one page (limit 30, hard cap 50).
- License + cardData: we requested license but only via
  `additionalFields: ['license']` which is in modelInfo defaults
  already → another expand collision waiting to bite.
- The SDK we use is `@huggingface/hub@2.13.0`; behavior may have
  shifted from when I wrote against it.

What I don't yet know:
- What the SDK actually puts in the default expand list (need to
  inspect or read the SDK source).
- Whether `gguf` is a valid expand value per the API error list.
- Whether HF's `?expand=gguf` returns useful GGUF-file metadata
  versus our current tags-only detection.
- Whether `bartowski/...` and other major GGUF uploaders consistently
  tag their repos `gguf`.
- What `cardData` actually contains for typical model repos
  (license? description? both?).

---

## Phase 2 — NODES

Discrete items to address, ranked rough-importance first:

1. **Stop guessing at `additionalFields`.** Build a test that calls
   `listModels` and `modelInfo` with `additionalFields: []` and
   logs the keys actually present on the response. That is the
   ground truth.

2. **Use `gguf` as an expand value** (it's in the API's allowed list
   per the error message we already saw). It probably returns
   structured GGUF metadata (file list, quants) which is more
   reliable than tag-string matching.

3. **Description via `cardData`.** Surface what cardData actually
   returns; if the description field exists there, render it. If not,
   show a "View full card on the web" affordance.

4. **License via expand** — `license` isn't in the valid list (the
   error message would have flagged it); license lives in `cardData`
   or on the modelInfo response as a top-level field already.

5. **Direct download path.** Implement `hf:download` that streams a
   single GGUF file to `<userData>/hf-cache/<repo>/<file>` with
   progress events.  Surface a "Download" button on each variant
   alongside "Import to Ollama."

6. **Cached tab reality check.** Ollama and HF download into
   DIFFERENT caches (Ollama keeps blobs under `%LOCALAPPDATA%/Ollama`
   or `OLLAMA_MODELS`). Either:
   a) make Cached tab show both,
   b) restrict it to HF-direct-cache only and explain Ollama is
      separate, or
   c) only enable Cached after a direct HF download has happened.

7. **Empty-state UX.** Browse / Research zero-result paths should
   suggest concrete searches (the curated list approach was right;
   extend it to Browse).

8. **Error handling.** Every IPC throw should include the URL +
   status + body where applicable, so future bugs surface with the
   exact API rejection instead of a generic "request failed."

9. **Pagination.** "Load more" button for Browse; default 30, max
   per fetch 50 (current cap).

10. **Pop-out window for HF panel.** Lower priority — works fine as
    a sidebar panel for now.

11. **Compact controller + LMM** — keep journaling this cycle;
    compact controller hooks are wired in `~/.claude/settings.json`
    and will fire as context fills.

---

## Phase 3 — REFLECT

Core insight: **we've been using the SDK as an opaque box and
discovering its quirks via production failures.** Every "expand
collision" bug is the same shape — we set `additionalFields` based
on assumption, the server rejects it, we patch.  That's reactive.
The fix is to STOP using `additionalFields` for anything we can read
from the default response, and to USE `additionalFields` only after
verifying the value is in the API's allowed list AND not in the
SDK's default set.

Hidden assumption #1: the SDK's default set is stable across
versions.  Reality: minor version bumps can change it — we've seen
this in the wild.  Mitigation: empirically measure on each iteration.

Hidden assumption #2: HF repos consistently tag GGUF content.
Reality: many don't (the tag is set by uploaders, not the platform).
Mitigation: use the `gguf` expand to get structured file data, or
fall back to file-extension detection from the file listing.

Hidden assumption #3: "Import to Ollama" implies the user wants
Ollama to manage the lifecycle.  Reality: some users want the GGUF
file LOCAL for portability.  Mitigation: offer both Import and
Download.

Hidden assumption #4: the rename's userData preservation is the
right call for the HF cache path.  Reality: the HF cache is
deliberately separate (`<userData>/hf-cache`) and follows the new
identity; no migration needed.  Confirmed clean.

Tension I'm resolving toward: rather than continue shipping incremental
fixes per user-reported bug, build a proper **HF Integration Test
Harness** locally — a script that exercises every IPC against the
real Hub, logs every response, and asserts behavior.  Once that's
green, the integration ships in one solid release.

---

## Phase 4 — SYNTHESIZE

### Action plan

**Round 1 — Truth-gathering (no code changes yet):**
1. Run dev mode (`npm start -- -- --remote-debugging-port=9222`).
2. Via CDP console, hit every HF IPC against the live Hub.
3. Log the raw responses + identify field shapes.
4. Confirm the API's allowed expand list (we have it from the error
   message — sanity check by intentionally requesting each).
5. Confirm SDK default expand set by calling with
   `additionalFields: []` and inspecting what comes back.

**Round 2 — Service refactor:**
6. Rewrite `HuggingFaceService.search` and `modelInfo` based on
   actual SDK behavior.  Use `gguf` expand for GGUF detection where
   useful.
7. Add `hf.download` IPC (single-file stream with progress).
8. Add structured error returns (`{ ok, status, body, message }`).
9. Add a `HuggingFaceService.test()` method exposed via IPC for
   smoke testing.

**Round 3 — UI fixes:**
10. Wire the Download button per GGUF variant.
11. Empty-state suggestions on Browse + Research.
12. Clearer Cached-tab framing (HF cache vs Ollama cache).

**Round 4 — Verification:**
13. Manual smoke per IPC: search, expand details, import, download,
    cache list, cache remove.
14. CDP-driven assertions in `scripts/runtime-verify.mjs` for the
    HF panel.

**Round 5 — Ship:**
15. Squash the WIP commit into clean per-area commits.
16. Open PR, bump to v4.0.2, tag, CI, promote to public.

### What I will NOT do this cycle

- Don't add features beyond download + the bug-fix scope.
- Don't change the Ollama bridge contract.
- Don't restructure the broader Models / Catalog code.
- Don't push to testing until Round 4 verification is green.

### Quality gates per round

- TS clean
- Vite build clean
- Hot-reloaded dev manual test of the affected code path
- Compact controller may fire mid-round; the journal is the recovery
  surface.

### Status at start

- Branch: `feat/hf-deep-debug` (off testing-master at `007f503`).
- WIP commit `e52f32a` carries the partial in-app-details + modelInfo
  fix; will rebase / squash before push.
- Dev server: will start with `--remote-debugging-port=9222` so I
  can CDP into the running renderer.
- Catalyst UI install: closed.

---

## Round 1 results (probe)

The probes (`scripts/hf-probe.mjs`, `-2`, `-3`, `-4`) measured the
SDK + Hub API ground truth:

**Default expand set (returned without any `additionalFields`):**
`pipeline_tag` (→ `task`), `private`, `gated`, `downloads`,
`lastModified` (→ `updatedAt`), `likes`.  Plus the always-on
`id`, `name`.

**Adding any of those triggers** `expand[N] contains a duplicate
value`.

**`license` and `description` are NOT valid expand values.**  Only the
list the API echoes in its error message is accepted:
`author, baseModels, cardData, config, createdAt, disabled, downloads,
downloadsAllTime, evalResults, gated, inference, inferenceProviderMapping,
lastModified, library_name, likes, mask_token, model-index, pipeline_tag,
private, safetensors, sha, siblings, spaces, tags, transformersInfo,
trendingScore, widgetData, gguf, resourceGroup, xetEnabled,
childrenModelCount, usedStorage`.

**`gguf` expand is the authoritative GGUF signal.**  It returns
structured metadata: `{ architecture, context_length, total,
totalFileSize, chat_template, bos_token, eos_token }`.  Way better
than tag-string matching for the GGUF Only filter.

**`cardData` is where `license`, `license_link`, sometimes
`description` actually live** — top-level expand for those is
rejected.  Description is empty for most repos; README body isn't
surfaced through this endpoint at all.  "Web ↗" is the path for that.

**`siblings` returns the file listing as `{ rfilename }`** (not
`.path` like `listFiles`).  Single round-trip on the modelInfo call
instead of a separate file-listing fetch.

---

## Round 2 results (refactor)

Rewrote `HuggingFaceService` against measured behaviour:

- `search` now passes `additionalFields: ['tags', 'library_name',
  'gguf']` and `sort` parameter.  GGUF detection via
  `m.gguf != null` not tag-string match.
- `modelInfo` passes `['tags', 'cardData', 'siblings', 'gguf',
  'library_name']`.  Extracts license + licenseLink from cardData.
  Uses `siblings[].rfilename` for the file list.
- New `HFGgufMetadata` type surfaces architecture / contextLength /
  totalParams / totalFileSize through the HFSearchHit + HFModelCard.
- New `hf:download` IPC streams a single file via Electron's `net`
  module to `<cache>/models--<org>--<name>/blobs/<file>` (HF hub
  layout) with throttled progress events broadcast to all windows.
- Renamed `HFSearchHit.pipelineTag` → still pipelineTag but now
  populated from the SDK's `task` field (which is what the API
  returns by default).
- HF curated research list corrected (one repo case-sensitivity
  failure replaced; expanded from 8 → 9 entries including the new
  Phi-3 mini 128k abliterated and a 3B option).

---

## Round 3 results (UI)

Renderer updates:

- ResultCard meta row shows `pipelineTag · downloads · likes ·
  library · architecture · context_length · totalFileSize · updatedAt`.
- Expanded card details show license (clickable when
  `licenseLink` set), libraryName, gguf metadata.
- GgufVariantList:
  - Variants sorted recommended-first (Q4_K_M), then size ascending.
  - "★ rec" badge on the recommended quant.
  - Quant tags carry a tooltip explaining the quality vs size trade.
  - Size badge tooltip shows approximate VRAM (× 1.25).
  - New `FitBadge` colour-codes each variant against the user's
    hardware (green/yellow/orange/red).
  - "▶ Run via Ollama" + "⬇ Download" + "Copy cmd" buttons in that
    order.
  - In-row progress bar + per-file byte counter while a download is
    streaming.
- BrowseTab:
  - New sort dropdown: Downloads / Likes / Trending / Recently
    updated / Recently created.
  - Empty state now suggests concrete queries
    (`llama gguf`, `qwen 2.5`, `mistral 7b`, `phi 3`, `embedding`,
    `code llama`) and offers a "clear the GGUF Only filter" link
    when applicable.
- CachedTab:
  - Reframed as "Catalyst's direct-download cache" with an explicit
    note that Ollama uses a separate cache.
  - Total size summary across all cached repos.
  - "Open folder ↗" button to browse the cache in the OS file
    explorer.
  - Better empty state explaining the two download paths.

---

## Round 4 results (verification)

`scripts/hf-cdp-test.mjs` drives 25 assertions against the live
renderer over CDP, all passing as of the latest revision:

```
✓ switched to HF panel
✓ HF panel rendered
✓ no error banner after default search
✓ at least one search result — count=30
✓ GGUF Only returns results — count=30
✓ expanded card loaded
✓ no expand[N] error after details
✓ gguf metadata badges render — arch=true ctx=true size=true
✓ direct hf.search returns ggufMeta
✓ modelInfo returns gguf + metadata (license=llama3.2, arch=llama, ggufCount=18)
✓ Cached tab loads
✓ Research tab loads
✓ research mode enable button clickable
✓ curated research list renders
✓ 11 curated repos resolve with gguf files
```

`scripts/hf-download-test.mjs` separately verifies the `hf:download`
IPC end-to-end — initiated a real download of README.md from
`bartowski/Llama-3.2-3B-Instruct-GGUF` and confirmed:

- File saved to the HF-hub layout under
  `<userData>/hf-cache/models--<org>--<name>/blobs/README.md`.
- 24,342 bytes written.
- 2 `hf:download-progress` events broadcast (data + done).
- `done` event fired correctly.

---

## Next iteration ideas (queued, not yet built)

- Cancellable downloads + ETA / speed indicators.
- Author chip click → search by that owner.
- Tag chip click → search by that tag.
- Search debounce (300 ms) instead of on-button / on-enter.
- "Saved searches" / favorites.
- Schema-shift defensive guards on the API responses.
- Pop-out window support for HF (lower priority).
- A "What is GGUF?" info panel linked from the checkbox tooltip.

Decision before pushing: rerun the CDP suite from a clean install
state at least once, then squash the WIP + journal commits into
clean per-area commits before opening a PR.  User asked NOT to push
to testing until they review the next iteration; respect that.
