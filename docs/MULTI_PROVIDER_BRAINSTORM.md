# Multi-Provider Brainstorm

> R&D scratchpad for the provider abstraction (Cat 6 + future expansion).
> Last updated 2026-05-27 alongside the Gemini / Aider / OpenRouter wiring.

This is a **reference**, not a design doc. The actual implementation lives in:

- `src/main/provider-auth-service.ts` — per-provider key store (Cat 5).
- `src/main/pty-key-interceptor.ts` — auth-prompt detection (Cat 5).
- `src/main/provider-detect.ts` — CLI availability probing (Cat 6).
- `src/main/model-catalog-seed.ts` — Gemini / Aider / OpenRouter entries (Cat 6).

---

## Provider taxonomy

Three orthogonal axes for any "provider" the app can run:

1. **CLI vs API vs local-daemon.**
   - **CLI**: a third-party binary that we spawn via PTY (`claude`, `gemini`, `aider`). User interacts with the spawned program directly.
   - **API**: a service we'd talk to over HTTPS, no spawned process. Not currently used — the app prefers spawning CLIs because the chat experience + tool use is owned by the CLI, not us.
   - **Local-daemon**: a long-running local service we manage (Ollama). Models are pulled into it; launching = `ollama run <name>`. The daemon process is shared across all local models.

2. **Auth shape.** Some CLIs accept OAuth flows (Claude `/login`); others read an env var (`OPENAI_API_KEY`); some interactively prompt on first run (Aider). The app's universal API-key UI (Cat 5) handles the env-var case + the prompt-interception case. OAuth is provider-specific and handled by the CLI itself.

3. **Bundling.** Today: we bundle Claude CLI via the NSIS installer's Phase 4 npm-install step. Everything else is user-installed (gemini-cli, aider, ollama). Cat 8 installer overhaul keeps that policy — adds an opt-in Ollama install at install time, not an "install every CLI" workflow.

---

## Candidate providers + status

### Anthropic (Claude CLI) — shipping ✅
- **CLI**: `claude` (bundled via NSIS Phase 4).
- **Auth**: OAuth via `/login` slash-command. API key via `ANTHROPIC_API_KEY` env var also supported.
- **Notes**: This is the primary. Cat 5's pre-launch modal will offer to save an API key for Anthropic too, but Claude users typically use OAuth so most never hit it.

### Google (Gemini CLI) — wired in Cat 6 ✅
- **CLI**: `gemini` from `npm install -g @google/gemini-cli`.
- **Auth**: `GEMINI_API_KEY` env var. Key from https://aistudio.google.com/apikey.
- **Strengths**: 1M-token context window on Pro/2.0 Pro; strong multimodal.
- **Catalog entry**: `api.google.gemini-cli`.

### OpenAI (no official CLI) — accessed via Aider ⚠️
- **CLI**: None official from OpenAI.
- **Workaround**: Aider with `--model gpt-4o` (or any OpenAI model id).
- **Auth**: `OPENAI_API_KEY` env var. Key from https://platform.openai.com/api-keys.
- **Catalog entry**: `api.aider.multi` with `--model gpt-4o` default args.
- **Risk**: tying OpenAI access to Aider means Aider's regressions block OpenAI users. If OpenAI ships an official CLI later, swap in a dedicated entry.

### Aider (multi-provider OSS CLI) — wired in Cat 6 ✅
- **CLI**: `aider` from `pip install aider-chat`.
- **Auth**: env vars per model — Aider picks the right one based on the `--model` flag. We default to `--model gpt-4o` for the catalog entry; users can change via "Add custom model" or by editing the seed.
- **Strengths**: repo-aware editing, diff-review-per-edit, works across Anthropic / OpenAI / Gemini / OpenRouter.
- **Catalog entries**: `api.aider.multi` (gpt-4o), `api.openrouter.aider` (OpenRouter-routed).

### OpenRouter (API aggregator) — wired via Aider in Cat 6 ✅
- **CLI**: None of its own. We use Aider with `--openai-api-base https://openrouter.ai/api/v1` since OpenRouter speaks the OpenAI protocol.
- **Auth**: `OPENROUTER_API_KEY` env var. Key from https://openrouter.ai/keys.
- **Catalog entry**: `api.openrouter.aider`.

### llama.cpp (alternative to Ollama) — not wired ❌
- **Runtime**: `llama-server` (HTTP) or `llama-cli` (interactive).
- **Status**: Ollama covers the local-model space sufficiently for v3. Adding llama.cpp as a second local runtime means double the catalog work + double the download. Defer until a real user need emerges.

### Codex / ChatGPT CLI — does not exist ❌
- OpenAI has not released an official terminal client. The community uses Aider/aichat/sgpt/llm.
- No catalog entry; users who want this go through Aider.

### Cline / Continue.dev / Cursor CLI — out of scope ❌
- These are IDE extensions, not standalone CLIs. Embedding them inside Claude Code Studio doesn't map cleanly to our terminal-first UX.

---

## The abstraction (what code does, what it doesn't)

The v3 catalog data model in `ModelDefinition` already carries `provider`, `command`, `args` — enough for `pty-registry.spawn(opts)` to launch any provider's CLI without a per-provider runtime class. What we DO need centralized:

1. **Display-name normalization** → `normalizeProvider()` in `provider-auth-service.ts`.
2. **Env-var mapping** per provider → `PROVIDER_ENV_KEY` in `provider-auth-service.ts`.
3. **CLI detection** per non-bundled CLI → `provider-detect.ts`.
4. **Prompt regex patterns** for interactive auth → `pty-key-interceptor.ts` PROMPT_PATTERNS.
5. **Install hints** for "you don't have this CLI yet" → `PROVIDER_CLIS` in `provider-detect.ts`.

Each of those is a small map keyed by provider id. Adding a provider = adding entries to those 5 maps + a catalog entry in `model-catalog-seed.ts`. **No new runtime class per provider** unless the spawn semantics genuinely differ (e.g. if we add llama.cpp's HTTP server, that's a different shape than PTY spawning).

---

## Open questions for future work

- **OAuth providers beyond Anthropic.** Google and OpenAI both support OAuth flows in their dashboards but their CLIs don't surface them. If a future CLI prefers OAuth, we'd need a per-provider OAuth flow in main — bigger work than env-var injection.
- **Custom providers** (user-defined, not in the seed catalog). Currently `KNOWN_PROVIDERS` in `provider-auth-service.ts` is closed. Opening it requires widening `ProviderId` from a finite union to `string` + adding a `provider-id-validation` step.
- **Per-provider model lists from the provider's API.** Static catalog entries grow stale as providers ship new models. A `provider.listModels()` IPC that hits the provider's `/models` endpoint would let the catalog stay fresh. Deferred — would need per-provider API client code, not just CLI spawning.
- **Aider's MODEL_API_BASE / OPENAI_API_BASE redirects.** OpenRouter via Aider works because Aider speaks OpenAI protocol. If a future provider wants its own protocol, we'd need a real Aider-like agent, not just a CLI wrapper. Not in scope.
- **Per-pane provider tagging.** Today we attach the interceptor based on the model's `provider` field at spawn time. If a user uses `/model openai/gpt-4o` inside an Aider session, the underlying provider effectively changes. We don't currently re-attach. Acceptable trade-off — the interceptor's worst case is "doesn't fire" and the user falls back to setting the key in Settings.
