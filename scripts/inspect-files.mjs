import { listFiles } from '@huggingface/hub';
const repos = ['lmg-anon/vntl-llama3-8b-v2-gguf', 'bartowski/Llama-3.2-3B-Instruct-GGUF', 'hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF', 'failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF'];
for (const repo of repos) {
  console.log('\n' + repo);
  const files = [];
  for await (const f of listFiles({ repo: { type: 'model', name: repo } })) {
    if (/\.gguf$/i.test(f.path)) files.push(f.path);
  }
  for (const f of files.slice(0, 6)) console.log('  ', f);
}
