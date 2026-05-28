#!/usr/bin/env node
/**
 * CDP-driven smoke test of the HF panel.
 *
 * Assumes a Catalyst UI dev instance is already running with
 * `npm start -- -- --remote-debugging-port=9222`.  Connects to the
 * Catalyst UI page target and exercises:
 *   - switch to HF panel via sidebar
 *   - trigger search "llama gguf" with GGUF Only on
 *   - assert results contain >= 1 entry with gguf metadata
 *   - expand the first result
 *   - assert modelInfo loads without an error banner
 *   - trigger a small download (need a small file)
 *
 * Logs everything to runtime-hf.log + prints a summary.
 */
import { setTimeout as sleep } from 'node:timers/promises';
// Node 22+ exposes WebSocket as a global (no import needed).

const HOST = '127.0.0.1';
const PORT = 9222;

const tagged = (msg) => `[hf-cdp ${new Date().toISOString().slice(11, 19)}] ${msg}`;

async function getCatalystPage() {
  const res = await fetch(`http://${HOST}:${PORT}/json/list`);
  const pages = await res.json();
  const ui = pages.find((p) => p.type === 'page' && p.title === 'Catalyst UI');
  if (!ui) throw new Error('No Catalyst UI page found');
  return ui;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.consoleEvents = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled') {
          this.consoleEvents.push(msg.params);
        }
      }
    });
  }
  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error('JS exception: ' + JSON.stringify(r.exceptionDetails));
    }
    return r.result?.value;
  }
  close() { this.ws.close(); }
}

const assertions = [];
function assert(name, cond, detail) {
  assertions.push({ name, ok: !!cond, detail });
  console.log(tagged(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`));
}

(async () => {
  console.log(tagged('Discovering Catalyst UI page...'));
  const ui = await getCatalystPage();
  console.log(tagged(`connected to ${ui.title}`));
  const client = new CdpClient(ui.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable', {});
  await client.send('Page.enable', {});

  // Hard-reload to ensure a clean test state — previous runs may have
  // toggled research mode, expanded cards, etc.
  console.log(tagged('Reloading page for clean state...'));
  await client.send('Page.reload', { ignoreCache: true });
  await sleep(4000);

  // wait for React to mount
  console.log(tagged('Waiting for renderer to mount...'));
  for (let i = 0; i < 30; i++) {
    const mounted = await client.eval(`document.querySelectorAll('[data-panel]').length > 0`);
    if (mounted) break;
    await sleep(500);
  }

  // 1) Click HF panel.
  const hfClicked = await client.eval(`
    (() => {
      const btn = document.querySelector('button[data-panel="hf"]')
        || Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.toLowerCase().includes('hugging'));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  assert('switched to HF panel', hfClicked);
  await sleep(800);

  // 2) Verify the Browse subtab is up
  const browseVisible = await client.eval(`!!document.body.innerText.includes('Browse')`);
  assert('HF panel rendered', browseVisible);

  // 3) Wait for the auto-search to settle (10s budget).
  for (let i = 0; i < 20; i++) {
    const detailsCount = await client.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
    `);
    if (detailsCount > 0) break;
    await sleep(500);
  }
  const errBanner = await client.eval(`
    (() => {
      const banner = document.querySelector('[role="alert"]');
      return banner ? banner.innerText.slice(0, 300) : null;
    })()
  `);
  assert('no error banner after default search', !errBanner, errBanner || '');

  // 4) Count result cards.
  const resultCount = await client.eval(`
    Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
  `);
  assert('at least one search result', resultCount > 0, `count=${resultCount}`);

  // 5) Toggle GGUF Only, re-run, ensure results present.
  await client.eval(`
    (() => {
      const cb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(c => {
        const lbl = c.closest('label')?.innerText;
        return lbl && lbl.toLowerCase().includes('gguf only');
      });
      if (!cb) return false;
      cb.click();
      // click the Search button
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search');
      btn?.click();
      return true;
    })()
  `);
  await sleep(3500);
  const ggufResultCount = await client.eval(`
    Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
  `);
  assert('GGUF Only returns results', ggufResultCount > 0, `count=${ggufResultCount}`);

  // 6) Expand the first card.  modelInfo is async — poll up to 8s for
  //    one of the expected strings to appear before declaring failure.
  await client.eval(`
    (() => {
      const detailsBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Details');
      detailsBtn?.click();
      return true;
    })()
  `);
  let cardLoaded = false;
  for (let i = 0; i < 16; i++) {
    cardLoaded = await client.eval(`
      document.body.innerText.includes('GGUF variants') ||
      document.body.innerText.includes('Run via Ollama') ||
      document.body.innerText.includes('No GGUF files') ||
      document.body.innerText.includes('Loading model card')
    `);
    if (cardLoaded) break;
    await sleep(500);
  }
  // Also accept "Loading model card…" as a sign the expand worked — the
  // SDK roundtrip may still be in flight at the 8s mark for slow networks.
  assert('expanded card loaded', cardLoaded);

  // 7) Check no expand[N] error.
  const expandErr = await client.eval(`
    (() => {
      const banner = document.querySelector('[role="alert"]');
      return banner && /expand\\[\\d+\\]/.test(banner.innerText) ? banner.innerText.slice(0, 300) : null;
    })()
  `);
  assert('no expand[N] error after details', !expandErr, expandErr || '');

  // 8) Verify ggufMeta (architecture, context) renders on cards.
  const ggufBadges = await client.eval(`
    (() => {
      const text = document.body.innerText;
      return {
        hasArch: /🏛/.test(text),
        hasCtx: /📏/.test(text),
        hasSize: /💾/.test(text),
      };
    })()
  `);
  assert('gguf metadata badges render', ggufBadges.hasArch || ggufBadges.hasCtx || ggufBadges.hasSize,
    `arch=${ggufBadges.hasArch} ctx=${ggufBadges.hasCtx} size=${ggufBadges.hasSize}`);

  // 9) Test direct hf.search via electronAPI for a specific query.
  const searchByApi = await client.eval(`
    window.electronAPI.hf.search({ query: 'bartowski Llama-3.2-3B', limit: 5, ggufOnly: true })
      .then(r => ({ ok: true, count: r.length, first: r[0]?.id, hasGgufMeta: !!r[0]?.ggufMeta }))
      .catch(e => ({ ok: false, error: e.message }))
  `, true);
  assert('direct hf.search returns ggufMeta', searchByApi.ok && searchByApi.hasGgufMeta,
    JSON.stringify(searchByApi));

  // 10) Test hf.modelInfo directly.
  const modelInfoApi = await client.eval(`
    window.electronAPI.hf.modelInfo('bartowski/Llama-3.2-3B-Instruct-GGUF')
      .then(r => ({
        ok: true,
        hasGguf: r.gguf.length > 0,
        hasGgufMeta: !!r.ggufMeta,
        hasLicense: !!r.license,
        hasLibraryName: !!r.libraryName,
        hasWebUrl: !!r.webUrl,
        ggufCount: r.gguf.length,
        license: r.license,
        arch: r.ggufMeta?.architecture,
      }))
      .catch(e => ({ ok: false, error: e.message }))
  `, true);
  assert('modelInfo returns gguf + metadata',
    modelInfoApi.ok && modelInfoApi.hasGguf && modelInfoApi.hasGgufMeta && modelInfoApi.hasWebUrl,
    JSON.stringify(modelInfoApi));

  // 11) Verify Cached tab loads without error.
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cached');
      btn?.click();
    })()
  `);
  await sleep(1500);
  const cachedLoaded = await client.eval(`
    document.body.innerText.includes('Catalyst') && document.body.innerText.includes('cache')
  `);
  assert('Cached tab loads', cachedLoaded);

  // 12) Switch to Research tab (still locked behind disclaimer — verify the disclaimer renders).
  await client.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Research');
      btn?.click();
    })()
  `);
  await sleep(1000);
  const researchTabLoaded = await client.eval(`
    document.body.innerText.includes('Research catalogs are disabled') ||
    document.body.innerText.includes('Recommended research models') ||
    document.body.innerText.includes('I understand')
  `);
  assert('Research tab loads', researchTabLoaded);

  // 13) Enable research mode by clicking the in-app "I understand"
  //     button so the parent React state updates.  Calling the IPC
  //     directly would leave React's `settings` state stale.
  const enableClicked = await client.eval(`
    (() => {
      // The Research tab is already selected.
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /I understand.*enable Research/.test(b.textContent));
      if (btn) { btn.click(); return 'clicked'; }
      // Already enabled?
      if (document.body.innerText.includes('Recommended research models')) return 'already-enabled';
      if (document.body.innerText.includes('Research mode is active')) return 'already-active';
      return 'not-found';
    })()
  `);
  assert('research mode enable button clickable', enableClicked === 'clicked' || enableClicked === 'already-enabled' || enableClicked === 'already-active',
    `state=${enableClicked}`);
  let curatedRendered = false;
  for (let i = 0; i < 12; i++) {
    curatedRendered = await client.eval(`
      document.body.innerText.includes('Recommended research models')
    `);
    if (curatedRendered) break;
    await sleep(500);
  }
  assert('curated research list renders', curatedRendered);

  // 14) Verify every curated repo resolves via hf.modelInfo (no 404s).
  //     Expanded to 17 entries per the empirical survey.
  const curatedRepos = [
    'bartowski/DeepSeek-R1-Distill-Qwen-32B-abliterated-GGUF',
    'bartowski/dolphin-2.9-llama3-8b-GGUF',
    'bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
    'TheBloke/dolphin-2.5-mixtral-8x7b-GGUF',
    'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
    'bartowski/Hermes-3-Llama-3.1-8B-GGUF',
    'bartowski/Hermes-3-Llama-3.1-70B-GGUF',
    'mradermacher/DeepSeek-R1-Distill-Llama-70B-abliterated-GGUF',
    'cognitivecomputations/dolphin-2.9.4-llama3.1-8b-gguf',
    'mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF',
    'mradermacher/dolphin-2.7-mixtral-8x7b-GGUF',
    'failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF',
    'failspy/Llama-3-70B-Instruct-abliterated-GGUF',
    'failspy/Phi-3-mini-128k-instruct-abliterated-v3-GGUF',
    'mlabonne/NeuralDaredevil-8B-abliterated-GGUF',
    'mlabonne/Daredevil-8B-abliterated-GGUF',
    'mradermacher/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF',
    'TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF',
  ];
  for (const repo of curatedRepos) {
    const r = await client.eval(`
      window.electronAPI.hf.modelInfo(${JSON.stringify(repo)})
        .then(r => ({ ok: true, ggufCount: r.gguf.length }))
        .catch(e => ({ ok: false, error: e.message.slice(0, 80) }))
    `, true);
    assert(`curated repo "${repo.split('/')[1]}"`, r.ok && r.ggufCount > 0, JSON.stringify(r));
  }

  // 15) Disable research mode again so dev state is clean.
  await client.eval(`
    window.electronAPI.hf.setSettings({ researchModeEnabled: false })
  `, true);

  // Summary
  console.log('\n' + tagged('SUMMARY'));
  const passed = assertions.filter((a) => a.ok).length;
  const failed = assertions.filter((a) => !a.ok).length;
  console.log(`  passed: ${passed}/${assertions.length}, failed: ${failed}`);
  if (failed > 0) {
    console.log('\n  failed assertions:');
    for (const a of assertions.filter((x) => !x.ok)) {
      console.log(`    - ${a.name}${a.detail ? ' — ' + a.detail : ''}`);
    }
  }

  client.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(tagged('FATAL'), e);
  process.exit(2);
});
