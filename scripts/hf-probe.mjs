/**
 * HF probe — measures the @huggingface/hub SDK + Hub API ground truth
 * before we change any of HuggingFaceService.
 *
 * Run: `node scripts/hf-probe.mjs`
 *
 * Logs:
 *   - what listModels returns by default (with additionalFields: [])
 *   - which `additionalFields` values the Hub accepts vs rejects
 *   - what modelInfo returns for a known GGUF repo
 *   - whether `gguf` expand exposes structured file data
 */
import { listModels, modelInfo, listFiles } from '@huggingface/hub';

// ---- helpers ----

function header(s) {
  console.log('\n' + '='.repeat(70));
  console.log(s);
  console.log('='.repeat(70));
}

function safeJson(o, depth = 1) {
  try {
    return JSON.stringify(o, null, depth);
  } catch {
    return String(o);
  }
}

async function probe(name, fn) {
  process.stdout.write(`\n[${name}] `);
  try {
    const r = await fn();
    process.stdout.write('OK\n');
    return { ok: true, result: r };
  } catch (e) {
    process.stdout.write(`FAIL: ${e.message ?? e}\n`);
    return { ok: false, error: e.message ?? String(e) };
  }
}

// ---- probes ----

async function probeListModelsBare() {
  header('listModels — empty additionalFields, take 1 result');
  const it = listModels({
    search: { query: 'gpt' },
    limit: 1,
    additionalFields: [],
  });
  for await (const m of it) {
    console.log('keys returned:', Object.keys(m).sort().join(', '));
    console.log('shape sample:', safeJson(m, 2).slice(0, 1200));
    return m;
  }
  console.log('(no results)');
  return null;
}

async function probeListModelsCandidates() {
  header('listModels — try each expand value individually');
  // The expand values the Hub API accepted on past requests + the values
  // it listed in its rejection message.
  const candidates = [
    'tags',
    'pipeline_tag',
    'private',
    'gated',
    'downloads',
    'lastModified',
    'likes',
    'disabled',
    'downloadsAllTime',
    'cardData',
    'config',
    'library_name',
    'gguf',
    'safetensors',
    'siblings',
    'sha',
    'createdAt',
    'license',  // hypothesis: not a top-level expand value
    'description', // hypothesis: not valid
    'baseModels',
    'author',
    'trendingScore',
    'widgetData',
    'resourceGroup',
  ];
  const results = {};
  for (const field of candidates) {
    let ok = false;
    let err = null;
    try {
      const it = listModels({
        search: { query: 'test' },
        limit: 1,
        additionalFields: [field],
      });
      for await (const m of it) {
        results[field] = {
          ok: true,
          hasField: field in m,
          fieldType: m[field] === null ? 'null' : Array.isArray(m[field]) ? 'array' : typeof m[field],
        };
        ok = true;
        break;
      }
      if (!ok) results[field] = { ok: true, hasField: false, fieldType: 'no-results' };
    } catch (e) {
      results[field] = { ok: false, error: (e.message ?? String(e)).slice(0, 200) };
    }
  }
  for (const [field, info] of Object.entries(results)) {
    const status = info.ok ? '✓' : '✗';
    const detail = info.ok
      ? `(${info.fieldType}${info.hasField === false ? ', not on object' : ''})`
      : `(${info.error})`;
    console.log(`  ${status} ${field.padEnd(20)} ${detail}`);
  }
  return results;
}

async function probeModelInfoBare(repoId) {
  header(`modelInfo("${repoId}") — empty additionalFields`);
  try {
    const m = await modelInfo({ name: repoId, additionalFields: [] });
    console.log('keys returned:', Object.keys(m).sort().join(', '));
    console.log('shape sample:', safeJson(m, 2).slice(0, 2000));
    return m;
  } catch (e) {
    console.log('FAIL:', e.message ?? e);
    return null;
  }
}

async function probeModelInfoCandidates(repoId) {
  header(`modelInfo("${repoId}") — try each expand value individually`);
  const candidates = [
    'tags', 'pipeline_tag', 'private', 'gated', 'downloads', 'lastModified',
    'likes', 'disabled', 'downloadsAllTime', 'cardData', 'config', 'library_name',
    'gguf', 'safetensors', 'siblings', 'sha', 'createdAt', 'license',
    'description', 'baseModels', 'author', 'trendingScore', 'widgetData',
    'resourceGroup', 'transformersInfo', 'evalResults',
  ];
  const results = {};
  for (const field of candidates) {
    try {
      const m = await modelInfo({ name: repoId, additionalFields: [field] });
      results[field] = {
        ok: true,
        hasField: field in m,
        fieldType: m[field] === null ? 'null' : Array.isArray(m[field]) ? 'array' : typeof m[field],
      };
    } catch (e) {
      results[field] = { ok: false, error: (e.message ?? String(e)).slice(0, 200) };
    }
  }
  for (const [field, info] of Object.entries(results)) {
    const status = info.ok ? '✓' : '✗';
    const detail = info.ok
      ? `(${info.fieldType}${info.hasField === false ? ', not on object' : ''})`
      : `(${info.error})`;
    console.log(`  ${status} ${field.padEnd(20)} ${detail}`);
  }
  return results;
}

async function probeGgufExpand(repoId) {
  header(`modelInfo("${repoId}") — gguf expand specifically`);
  try {
    const m = await modelInfo({ name: repoId, additionalFields: ['gguf'] });
    console.log('gguf field:', safeJson(m.gguf, 2));
  } catch (e) {
    console.log('FAIL:', e.message ?? e);
  }
}

async function probeListFiles(repoId) {
  header(`listFiles("${repoId}") — first 10 entries`);
  try {
    const files = [];
    for await (const f of listFiles({ repo: { type: 'model', name: repoId } })) {
      files.push({
        path: f.path,
        size: f.size,
        type: f.type,
      });
      if (files.length >= 10) break;
    }
    console.log(safeJson(files, 2));
  } catch (e) {
    console.log('FAIL:', e.message ?? e);
  }
}

// ---- main ----

const TEST_REPO_GGUF = 'bartowski/Llama-3.2-3B-Instruct-GGUF';
const TEST_REPO_GENERIC = 'meta-llama/Llama-3.2-3B-Instruct';

(async () => {
  console.log('Hugging Face probe');
  console.log('@huggingface/hub:', JSON.parse(await import('node:fs').then(fs => fs.promises.readFile('node_modules/@huggingface/hub/package.json', 'utf8'))).version);

  await probe('listModels-bare', probeListModelsBare);
  await probe('listModels-candidates', probeListModelsCandidates);
  await probe('modelInfo-bare-gguf', () => probeModelInfoBare(TEST_REPO_GGUF));
  await probe('modelInfo-candidates-gguf', () => probeModelInfoCandidates(TEST_REPO_GGUF));
  await probe('gguf-expand-gguf', () => probeGgufExpand(TEST_REPO_GGUF));
  await probe('listFiles-gguf', () => probeListFiles(TEST_REPO_GGUF));

  console.log('\n\nDone.');
})();
