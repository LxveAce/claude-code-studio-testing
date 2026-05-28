/**
 * Survey the wider field of uncensored / abliterated / jailbroken models
 * on HF Hub to assemble the best-in-class curated set for the Research
 * tab.  Verifies each repo is publicly accessible, has GGUF files, and
 * captures download counts to rank by user adoption.
 */
import { modelInfo, listModels } from '@huggingface/hub';

// Hand-picked candidates spanning size tiers, architectures, and lineages.
// Bias toward HIGH-DOWNLOAD repos that real users are running.
const candidates = [
  // ---- Llama 3 abliterated lineage (failspy and followers) ----
  'failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF',
  'failspy/Llama-3-70B-Instruct-abliterated-GGUF',
  'failspy/Phi-3-mini-128k-instruct-abliterated-v3-GGUF',
  'failspy/Phi-3-medium-128k-instruct-abliterated-v3-GGUF',
  // mlabonne — Daredevil + abliterated Hermes
  'mlabonne/Daredevil-8B-abliterated-GGUF',
  'mlabonne/NeuralDaredevil-8B-abliterated-GGUF',
  'mlabonne/Hermes-3-Llama-3.1-8B-abliterated-GGUF',
  'mlabonne/Llama-3-70B-Instruct-abliterated-GGUF',
  // ---- Cognitive Computations Dolphin (mradermacher + bartowski quants) ----
  'bartowski/dolphin-2.9-llama3-8b-GGUF',
  'mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF',
  'TheBloke/dolphin-2.5-mixtral-8x7b-GGUF',
  'cognitivecomputations/dolphin-2.9.4-llama3.1-8b-gguf',
  'bartowski/dolphin-2.9.4-llama3.1-70b-GGUF',
  // ---- Lexi uncensored ----
  'mradermacher/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF',
  'mradermacher/Llama-3.3-70B-Lexi-Uncensored-V2-GGUF',
  // ---- Hermes (Nous Research, neutral alignment) ----
  'bartowski/Hermes-3-Llama-3.1-8B-GGUF',
  'bartowski/Hermes-3-Llama-3.1-70B-GGUF',
  // ---- Wizard Vicuna (classic) ----
  'TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF',
  'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
  // ---- Smaller experimental ----
  'bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
  // ---- huihui-ai (high-volume Qwen abliterations) ----
  'huihui-ai/Qwen2.5-7B-Instruct-abliterated-GGUF',
  'huihui-ai/Qwen2.5-14B-Instruct-abliterated-GGUF',
  'huihui-ai/Qwen2.5-32B-Instruct-abliterated-GGUF',
  // ---- DeepSeek R1 distill abliterated (community favourite for reasoning) ----
  'bartowski/DeepSeek-R1-Distill-Qwen-7B-abliterated-GGUF',
  'bartowski/DeepSeek-R1-Distill-Qwen-14B-abliterated-GGUF',
  'bartowski/DeepSeek-R1-Distill-Qwen-32B-abliterated-GGUF',
  'mradermacher/DeepSeek-R1-Distill-Llama-70B-abliterated-GGUF',
  // ---- Mistral uncensored ----
  'TheBloke/Mistral-7B-Instruct-v0.2-uncensored-GGUF',
  'bartowski/Mistral-Nemo-Instruct-2407-abliterated-GGUF',
  // ---- Mixtral uncensored ----
  'mradermacher/dolphin-2.7-mixtral-8x7b-GGUF',
];

(async () => {
  console.log(`Surveying ${candidates.length} candidates...\n`);
  const results = [];
  for (const repo of candidates) {
    process.stdout.write(`  ${repo.padEnd(70)} `);
    try {
      const m = await modelInfo({
        name: repo,
        additionalFields: ['gguf', 'cardData', 'siblings', 'tags', 'downloadsAllTime'],
      });
      const gguf = m.siblings?.filter((s) => /\.gguf$/i.test(s.rfilename || '')) ?? [];
      const license = m.cardData?.license ?? null;
      const arch = m.gguf?.architecture ?? '?';
      const ctx = m.gguf?.context_length ?? null;
      const totalSize = m.gguf?.totalFileSize ?? null;
      results.push({
        repo,
        ok: true,
        downloads: m.downloads ?? 0,
        downloadsAllTime: m.downloadsAllTime ?? 0,
        gguf: gguf.length,
        arch,
        ctx,
        totalSize,
        license,
      });
      console.log(`OK ↓${(m.downloads ?? 0).toLocaleString()} arch=${arch} gguf=${gguf.length}`);
    } catch (e) {
      results.push({ repo, ok: false, error: (e.message ?? String(e)).slice(0, 80) });
      console.log(`FAIL — ${(e.message ?? String(e)).split('.')[0].slice(0, 60)}`);
    }
  }

  console.log('\n\n=== RANKED BY MONTHLY DOWNLOADS (passing only) ===');
  const passing = results.filter((r) => r.ok);
  passing.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  for (const r of passing.slice(0, 30)) {
    console.log(
      `  ↓${(r.downloads).toLocaleString().padStart(8)} | ${r.arch.padEnd(8)} | ctx ${String(r.ctx).padStart(6)} | gguf ${String(r.gguf).padStart(2)} | ${r.repo}`
    );
  }

  console.log('\n=== FAILED ===');
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  - ${r.repo}: ${r.error}`);
  }
})();
