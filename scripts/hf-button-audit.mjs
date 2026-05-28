/**
 * Exhaustive button audit for the HF panel.  Drives every interactive
 * element via CDP and reports anything that:
 *   - throws an exception in the renderer
 *   - logs to console.error
 *   - shows the [role="alert"] error banner
 *   - leaves the panel in an undefined state (e.g. empty when content expected)
 *
 * Run while a dev instance is up on :9222.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 9222;
const log = (m) => console.log(`[audit ${new Date().toISOString().slice(11, 19)}] ${m}`);

async function getPage() {
  const r = await fetch(`http://${HOST}:${PORT}/json/list`);
  const ps = await r.json();
  return ps.find((p) => p.type === 'page' && p.title === 'Catalyst UI');
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleEvents = [];
    this.exceptions = [];
    this.errorBanners = new Set();
    this.ready = new Promise((resolve) => this.ws.addEventListener('open', () => resolve()));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data.toString());
      if (m.id != null && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.consoleEvents.push(m.params);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params);
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
      expression: expr, awaitPromise, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result?.value;
  }
  async captureBanner() {
    const banner = await this.eval(`
      (() => {
        const a = document.querySelector('[role="alert"]');
        return a ? a.innerText.slice(0, 300) : null;
      })()
    `);
    if (banner) this.errorBanners.add(banner);
    return banner;
  }
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const ui = await getPage();
  const c = new Cdp(ui.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Runtime.enable', {});
  await c.send('Page.enable', {});
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(4500);

  // Switch to HF panel.
  await c.eval(`document.querySelector('button[data-panel="hf"]')?.click()`);
  await sleep(800);
  // Wait for first auto-search.
  for (let i = 0; i < 25; i++) {
    const ready = await c.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length > 0
    `);
    if (ready) break;
    await sleep(400);
  }

  // ----- BROWSE TAB -----
  log('=== BROWSE TAB ===');

  // 1. Sort dropdown — try every option.
  for (const sortVal of ['likes', 'trending', 'modified', 'created', 'downloads']) {
    await c.eval(`
      (() => {
        const sel = Array.from(document.querySelectorAll('select')).find(s =>
          Array.from(s.options).some(o => o.value === '${sortVal}'));
        if (!sel) return false;
        sel.value = '${sortVal}';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await sleep(300);
    // Click search to apply
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search')?.click()
    `);
    await sleep(2500);
    const banner = await c.captureBanner();
    const count = await c.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
    `);
    check(`sort=${sortVal} returns results`, !banner && count > 0, `count=${count} banner=${banner ?? '∅'}`);
  }

  // 2. Task filter — pick "text-generation".
  await c.eval(`
    (() => {
      const sel = Array.from(document.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => o.value === 'text-generation'));
      if (!sel) return false;
      sel.value = 'text-generation';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  await c.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search')?.click()`);
  await sleep(2500);
  {
    const banner = await c.captureBanner();
    const count = await c.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
    `);
    check('task filter=text-generation returns results', !banner && count > 0, `count=${count}`);
  }

  // Reset task filter.
  await c.eval(`
    (() => {
      const sel = Array.from(document.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => o.value === 'text-generation'));
      if (!sel) return;
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);

  // 3. GGUF Only toggle on, search, verify, toggle off.
  await c.eval(`
    (() => {
      const cb = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(c =>
        c.closest('label')?.innerText.toLowerCase().includes('gguf only'));
      cb.click();
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search')?.click();
    })()
  `);
  await sleep(2500);
  {
    const banner = await c.captureBanner();
    const count = await c.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
    `);
    check('GGUF Only=true returns results', !banner && count > 0, `count=${count}`);
  }

  // 4. Empty state suggestion chips — query something garbage, then click a chip.
  await c.eval(`
    (() => {
      const inp = document.querySelector('input[type="search"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'xyzqqq-zzzzz-nope-' + Math.random().toString(36).slice(2));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search')?.click();
    })()
  `);
  await sleep(2500);
  const emptyShown = await c.eval(`
    document.body.innerText.includes('No matches.') && Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'llama gguf')
  `);
  check('empty-state suggestion chips appear', emptyShown);

  if (emptyShown) {
    // Click the first chip.
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'llama gguf')?.click()
    `);
    await sleep(2800);
    const afterChip = await c.eval(`
      Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length
    `);
    check('chip click re-runs search', afterChip > 0, `count=${afterChip}`);
  }

  // 5. Details + Web ↗ + Hide details on first card.
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Details')?.click()
  `);
  await sleep(4000);
  let detailsTextShown = false;
  for (let i = 0; i < 12; i++) {
    detailsTextShown = await c.eval(`
      document.body.innerText.includes('GGUF variants') ||
      document.body.innerText.includes('Run via Ollama') ||
      document.body.innerText.includes('No GGUF files') ||
      document.body.innerText.includes('Loading model card')
    `);
    if (detailsTextShown) break;
    await sleep(400);
  }
  check('Details expands card content', detailsTextShown);

  const hideDetailsExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Hide details')
  `);
  check('Hide details button appears when expanded', hideDetailsExists);

  // Click Web ↗ — assert no exception (we can't actually navigate but the IPC must not throw).
  const beforeWeb = c.exceptions.length;
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => /Web .↗/.test(b.textContent))?.click()
  `);
  await sleep(400);
  check('Web ↗ button fires without exception', c.exceptions.length === beforeWeb);

  // Collapse details.
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Hide details')?.click()
  `);
  await sleep(300);

  // 6. Copy cmd on a variant (re-expand first).
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Details')?.click()
  `);
  await sleep(3500);
  const copyButtonExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Copy cmd')
  `);
  check('Copy cmd button present (variant)', copyButtonExists);
  if (copyButtonExists) {
    const beforeCopy = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Copy cmd')?.click()
    `);
    await sleep(300);
    check('Copy cmd button fires without exception', c.exceptions.length === beforeCopy);
  }

  // ----- CACHED TAB -----
  log('=== CACHED TAB ===');
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cached')?.click()
  `);
  await sleep(1500);
  const cachedBanner = await c.captureBanner();
  check('Cached tab loads without error banner', !cachedBanner, cachedBanner ?? '');

  const cachedHasRefresh = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /Refresh/.test(b.textContent))
  `);
  check('Cached has Refresh button', cachedHasRefresh);

  const cachedHasOpenFolder = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /Open folder/.test(b.textContent))
  `);
  check('Cached has Open folder button', cachedHasOpenFolder);

  if (cachedHasRefresh) {
    const beforeRefresh = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => /Refresh/.test(b.textContent))?.click()
    `);
    await sleep(800);
    check('Cached Refresh fires without exception', c.exceptions.length === beforeRefresh);
  }
  if (cachedHasOpenFolder) {
    const beforeOpen = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => /Open folder/.test(b.textContent))?.click()
    `);
    await sleep(400);
    check('Cached Open folder fires without exception', c.exceptions.length === beforeOpen);
  }

  // ----- RESEARCH TAB -----
  log('=== RESEARCH TAB ===');
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Research')?.click()
  `);
  await sleep(800);

  // Make sure research mode is on (click I understand if visible).
  await c.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /I understand.*enable Research/.test(b.textContent));
      btn?.click();
    })()
  `);
  await sleep(1200);

  const researchActive = await c.eval(`
    document.body.innerText.includes('Research mode is active')
  `);
  check('Research mode reads "active" banner', researchActive);

  const curatedShown = await c.eval(`
    document.body.innerText.includes('Recommended research models')
  `);
  check('Curated research list rendered', curatedShown);

  // Audit log: collapse arrow.
  const auditLogVisible = await c.eval(`
    document.body.innerText.includes('Research audit log')
  `);
  check('Research audit log section visible', auditLogVisible);

  // Search in Research tab.
  const researchSearchExists = await c.eval(`
    document.querySelectorAll('input[type="search"]').length > 0
  `);
  check('Research tab has search input', researchSearchExists);

  // Click Disable.
  const disableExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Disable')
  `);
  check('Research has Disable button', disableExists);
  if (disableExists) {
    const beforeDisable = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Disable')?.click()
    `);
    await sleep(800);
    const afterDisable = await c.eval(`
      document.body.innerText.includes('Research catalogs are disabled')
    `);
    check('Disable returns to disclaimer state', afterDisable);
    check('Disable fires without exception', c.exceptions.length === beforeDisable);
    // Re-enable for cleanup.
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => /I understand.*enable Research/.test(b.textContent))?.click()
    `);
    await sleep(800);
  }

  // ----- BACK TO BROWSE — verify Run via Ollama exists -----
  log('=== BROWSE — variant button presence ===');
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Browse')?.click()
  `);
  await sleep(800);
  // Make sure something is expanded (search by 'llama gguf', then expand).
  await c.eval(`
    (() => {
      const inp = document.querySelector('input[type="search"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'llama gguf');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search')?.click();
    })()
  `);
  await sleep(2500);
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Details')?.click()
  `);
  await sleep(3500);
  const runOllamaExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /Run via Ollama/.test(b.textContent))
  `);
  check('Run via Ollama button present on variant', runOllamaExists);
  const downloadExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /⬇ Download/.test(b.textContent))
  `);
  check('Download button present on variant', downloadExists);
  const recBadge = await c.eval(`
    document.body.innerText.includes('★ rec')
  `);
  check('★ rec badge appears on Q4_K_M variant', recBadge);
  const fitBadge = await c.eval(`
    /fits GPU|tight|CPU only|no fit/.test(document.body.innerText)
  `);
  check('Hardware FitBadge renders', fitBadge);

  // ----- CONSOLE / EXCEPTIONS audit -----
  log('=== Console + exceptions summary ===');
  const errorConsole = c.consoleEvents.filter((e) => e.type === 'error').length;
  const warnConsole = c.consoleEvents.filter((e) => e.type === 'warning').length;
  check('no exceptions thrown in renderer', c.exceptions.length === 0,
    c.exceptions.slice(-3).map((e) => e.exceptionDetails?.text).join(' | '));
  check('no console.error during audit', errorConsole === 0,
    `count=${errorConsole}`);
  console.log(`  console.warn count: ${warnConsole}`);
  if (c.errorBanners.size > 0) {
    console.log('  error banners observed:');
    for (const b of c.errorBanners) console.log('   - ' + b);
  }

  const passed = checks.filter((x) => x.ok).length;
  const failed = checks.filter((x) => !x.ok).length;
  console.log(`\n[audit] ${passed}/${checks.length} pass, ${failed} fail`);
  if (failed > 0) {
    console.log('failed:');
    for (const x of checks.filter((x) => !x.ok)) {
      console.log(`  - ${x.name}${x.detail ? ': ' + x.detail : ''}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
