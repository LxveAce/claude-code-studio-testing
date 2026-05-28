/**
 * HF probe round 2 — drill into cardData, siblings, gguf for the
 * fields the renderer actually needs (description, license, file list).
 */
import { modelInfo, listModels } from '@huggingface/hub';

const repos = [
  'bartowski/Llama-3.2-3B-Instruct-GGUF',           // a GGUF repo
  'meta-llama/Llama-3.2-3B-Instruct',                // a non-GGUF base
  'failspy/Llama-3-8B-Instruct-abliterated-v3',       // a base used by abliterated GGUF
  'openbmb/MiniCPM5-1B',                              // the repo from the user's error screenshot
];

(async () => {
  for (const r of repos) {
    console.log('\n' + '='.repeat(70));
    console.log('REPO:', r);
    console.log('='.repeat(70));
    try {
      const m = await modelInfo({
        name: r,
        additionalFields: ['cardData', 'siblings', 'gguf', 'tags', 'library_name', 'config'],
      });
      console.log('\n-- cardData keys --');
      console.log(m.cardData ? Object.keys(m.cardData).sort().join(', ') : '(none)');
      if (m.cardData) {
        console.log('\n-- cardData.license/description/model_name --');
        console.log('license:', m.cardData.license);
        console.log('license_name:', m.cardData.license_name);
        console.log('license_link:', m.cardData.license_link);
        console.log('description:', String(m.cardData.description ?? '').slice(0, 200));
        console.log('model_name:', m.cardData.model_name);
        console.log('base_model:', m.cardData.base_model);
        console.log('pipeline_tag:', m.cardData.pipeline_tag);
        console.log('tags-in-cardData:', m.cardData.tags ? m.cardData.tags.slice(0, 8) : null);
      }
      console.log('\n-- tags --');
      console.log(m.tags ? m.tags.slice(0, 15) : '(none)');
      console.log('\n-- library_name --');
      console.log(m.library_name);
      console.log('\n-- gguf (presence + shape) --');
      if (m.gguf) {
        console.log('PRESENT - keys:', Object.keys(m.gguf).sort().join(', '));
        console.log('architecture:', m.gguf.architecture);
        console.log('context_length:', m.gguf.context_length);
        console.log('total params:', m.gguf.total);
        console.log('totalFileSize:', m.gguf.totalFileSize);
      } else {
        console.log('(no gguf field)');
      }
      console.log('\n-- siblings (first 6) --');
      if (Array.isArray(m.siblings)) {
        console.log(m.siblings.slice(0, 6));
      } else {
        console.log(m.siblings);
      }
    } catch (e) {
      console.log('FAIL:', e.message ?? e);
    }
  }

  // Also check what listModels returns with our intended new field set.
  console.log('\n\n' + '='.repeat(70));
  console.log('listModels — additionalFields: ["tags", "library_name", "gguf"]');
  console.log('='.repeat(70));
  try {
    const it = listModels({
      search: { query: 'llama gguf' },
      limit: 3,
      additionalFields: ['tags', 'library_name', 'gguf'],
    });
    for await (const m of it) {
      console.log('-', m.name);
      console.log('  task:', m.task, '| downloads:', m.downloads, '| likes:', m.likes);
      console.log('  tags:', m.tags ? m.tags.slice(0, 6) : null);
      console.log('  library_name:', m.library_name);
      console.log('  gguf present:', !!m.gguf, m.gguf ? `(arch=${m.gguf.architecture}, ctx=${m.gguf.context_length})` : '');
    }
  } catch (e) {
    console.log('FAIL:', e.message ?? e);
  }
})();
