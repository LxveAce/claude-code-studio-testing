/**
 * HF probe round 3 — verify each curated research model is accessible
 * (some uncensored/abliterated repos require auth or are gated).
 */
import { modelInfo } from '@huggingface/hub';

const curated = [
  'failspy/llama-3-8b-Instruct-abliterated-v3-GGUF',
  'mradermacher/dolphin-2.9-llama3-8b-i1-GGUF',
  'TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF',
  'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
  'bartowski/Hermes-3-Llama-3.1-8B-GGUF',
  'mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF',
  'failspy/Llama-3-70B-Instruct-abliterated-GGUF',
  'TheBloke/dolphin-2.5-mixtral-8x7b-GGUF',
];

(async () => {
  for (const repo of curated) {
    process.stdout.write(`${repo}: `);
    try {
      const m = await modelInfo({
        name: repo,
        additionalFields: ['gguf', 'cardData', 'siblings'],
      });
      const ggufFiles = (m.siblings || [])
        .filter((s) => /\.gguf$/i.test(s.rfilename))
        .length;
      const gated = !!m.gated;
      const license = m.cardData?.license ?? '(no license in cardData)';
      console.log(
        `OK ` +
        `| gated: ${gated} ` +
        `| gguf-files: ${ggufFiles} ` +
        `| arch: ${m.gguf?.architecture ?? '?'} ` +
        `| ctx: ${m.gguf?.context_length ?? '?'} ` +
        `| license: ${license}`
      );
    } catch (e) {
      const msg = (e.message ?? String(e)).split('.')[0].slice(0, 80);
      console.log(`FAIL — ${msg}`);
    }
  }
})();
