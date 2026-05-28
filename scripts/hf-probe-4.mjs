/**
 * HF probe round 4 — fix the failing repo + survey a broader pool of
 * uncensored / abliterated GGUF models to find the best curated set.
 */
import { modelInfo, listModels } from '@huggingface/hub';

// Candidates including the case-corrected failspy + broader sweep.
const candidates = [
  // failspy abliterated lineup — case variants + alternates
  'failspy/Llama-3-8B-Instruct-abliterated-v3-GGUF',
  'failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF',
  'failspy/Llama-3-70B-Instruct-abliterated-GGUF',
  'failspy/Phi-3-mini-128k-instruct-abliterated-v3-GGUF',
  // mradermacher (high-volume uploader of i-matrix quants)
  'mradermacher/dolphin-2.9-llama3-8b-i1-GGUF',
  'mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF',
  'mradermacher/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF',
  // TheBloke classics
  'TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF',
  'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
  'TheBloke/dolphin-2.5-mixtral-8x7b-GGUF',
  // bartowski (high-volume GGUF quanter)
  'bartowski/Hermes-3-Llama-3.1-8B-GGUF',
  'bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
  // Cognitive Computations (Dolphin's home)
  'cognitivecomputations/dolphin-2.9.1-llama-3-70b-gguf',
  // Smaller dolphin variants
  'bartowski/dolphin-2.9-llama3-8b-GGUF',
  // Newer abliterated work
  'mlabonne/Hermes-3-Llama-3.1-8B-abliterated-GGUF',
  'mlabonne/Daredevil-8B-abliterated-GGUF',
];

(async () => {
  console.log('Surveying broader pool of research models...\n');
  for (const repo of candidates) {
    process.stdout.write(`  ${repo}: `);
    try {
      const m = await modelInfo({
        name: repo,
        additionalFields: ['gguf', 'cardData', 'siblings', 'downloadsAllTime'],
      });
      const ggufFiles = (m.siblings || []).filter((s) => /\.gguf$/i.test(s.rfilename));
      const license = m.cardData?.license ?? null;
      // Pick the Q4_K_M variant size if present, else the median.
      const q4km = ggufFiles.find((f) => /Q4_K_M\.gguf$/i.test(f.rfilename));
      console.log(
        `OK ` +
        `| ↓${(m.downloads ?? 0).toLocaleString()} ` +
        `| GGUF:${ggufFiles.length} ` +
        `| arch:${m.gguf?.architecture ?? '?'} ` +
        `| ctx:${m.gguf?.context_length?.toLocaleString() ?? '?'} ` +
        `| Q4_K_M:${q4km ? 'yes' : 'no'} ` +
        `| license:${license ?? '?'}`
      );
    } catch (e) {
      console.log(`FAIL — ${(e.message ?? String(e)).split('.')[0].slice(0, 60)}`);
    }
  }

  // Also: a sample live search to confirm the API is healthy.
  console.log('\n\nLive listModels search "abliterated gguf" (top 8):');
  try {
    const it = listModels({
      search: { query: 'abliterated gguf' },
      limit: 8,
      additionalFields: ['tags', 'gguf', 'downloadsAllTime'],
    });
    for await (const m of it) {
      const hasGguf = !!m.gguf;
      console.log(`  - ${m.name} ↓${(m.downloads ?? 0).toLocaleString()} gguf:${hasGguf} arch:${m.gguf?.architecture ?? '?'}`);
    }
  } catch (e) {
    console.log('FAIL:', e.message ?? e);
  }
})();
