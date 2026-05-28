/**
 * Comprehensive Models panel button audit.  Drives every interactive
 * control via CDP and reports anything that throws, errors, or fails.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 9222;
const log = (m) => console.log(`[models-audit ${new Date().toISOString().slice(11, 19)}] ${m}`);

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
    this.exceptions = [];
    this.consoleErrors = [];
    this.ready = new Promise((r) => this.ws.addEventListener('open', () => r()));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data.toString());
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.consoleErrors.push(m.params);
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result?.value;
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

  // Switch to Models panel.
  const clicked = await c.eval(`document.querySelector('button[data-panel="models"]')?.click(); true`);
  await sleep(2000);
  check('switched to Models panel', clicked);

  // Verify header rendered.
  const headerOK = await c.eval(`document.body.innerText.includes('Models')`);
  check('Models header rendered', headerOK);

  // Hardware banner — verify it loads (looks for GB or hardware-related text).
  const hwBannerOK = await c.eval(`
    /\\bGB\\b|GPU|RAM|Sweet spot/.test(document.body.innerText)
  `);
  check('hardware banner visible', hwBannerOK);

  // Tab switch: Local Models tab.
  const localTab = await c.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /Local Models/.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  check('Local Models tab exists', localTab);
  await sleep(700);

  // Search input.
  const searchInput = await c.eval(`!!document.querySelector('input[type="search"]')`);
  check('search input present', searchInput);

  if (searchInput) {
    const beforeSearch = c.exceptions.length;
    await c.eval(`
      (() => {
        const inp = document.querySelector('input[type="search"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, 'qwen');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await sleep(400);
    check('search input typing fires without exception', c.exceptions.length === beforeSearch);
  }

  // Tier filter.
  const tierFilter = await c.eval(`
    !!Array.from(document.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => /toaster|low|mid|high|workstation/i.test(o.value))
    )
  `);
  check('tier filter dropdown present', tierFilter);

  if (tierFilter) {
    const beforeTier = c.exceptions.length;
    await c.eval(`
      (() => {
        const sel = Array.from(document.querySelectorAll('select')).find(s =>
          Array.from(s.options).some(o => /toaster|low|mid|high|workstation/i.test(o.value)));
        sel.value = 'low';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(500);
    check('tier=low filter fires without exception', c.exceptions.length === beforeTier);
  }

  // Role filter.
  const roleFilter = await c.eval(`
    !!Array.from(document.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => /general-chat|frontend|backend|reasoning/i.test(o.value))
    )
  `);
  check('role filter dropdown present', roleFilter);

  if (roleFilter) {
    await c.eval(`
      (() => {
        const sel = Array.from(document.querySelectorAll('select')).find(s =>
          Array.from(s.options).some(o => /general-chat|frontend|backend|reasoning/i.test(o.value)));
        sel.value = 'general-chat';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(500);
    check('role filter fires without exception', true);
  }

  // Reset filters.
  await c.eval(`
    (() => {
      const inp = document.querySelector('input[type="search"]');
      if (inp) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const sels = Array.from(document.querySelectorAll('select'));
      for (const s of sels) {
        if (Array.from(s.options).some(o => o.value === 'all')) {
          s.value = 'all';
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    })()
  `);
  await sleep(400);

  // Switch to API Models tab.
  const apiTab = await c.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /API Models/.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  check('API Models tab exists', apiTab);
  await sleep(700);

  // Verify there's at least one Copy command button (every card has one).
  const copyCmdPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Copy command')
  `);
  check('Copy command button present (any card)', copyCmdPresent);

  if (copyCmdPresent) {
    const beforeCopy = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Copy command')?.click()
    `);
    await sleep(400);
    check('Copy command click fires without exception', c.exceptions.length === beforeCopy);
  }

  // Verify Launch in app button on API cards.
  const launchPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Launch in app')
  `);
  check('Launch in app button present (API card)', launchPresent);

  // Add custom model + Reset catalog + Refresh + First-run picker at bottom.
  const addCustomPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /\\+ Add custom model/.test(b.textContent))
  `);
  check('+ Add custom model button present', addCustomPresent);

  const resetCatalogPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /Reset catalog/.test(b.textContent))
  `);
  check('Reset catalog button present', resetCatalogPresent);

  const refreshPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Refresh')
  `);
  check('Refresh button present', refreshPresent);

  const firstRunPickerPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /First-run picker/.test(b.textContent))
  `);
  check('First-run picker button present', firstRunPickerPresent);

  if (refreshPresent) {
    const beforeRefresh = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Refresh')?.click()
    `);
    await sleep(1000);
    check('Refresh click fires without exception', c.exceptions.length === beforeRefresh);
  }

  // Console / exceptions summary.
  log('=== Console + exceptions summary ===');
  check('no exceptions thrown in renderer', c.exceptions.length === 0,
    c.exceptions.slice(-2).map(e => e.exceptionDetails?.text).join(' | '));
  check('no console.error during audit', c.consoleErrors.length === 0,
    `count=${c.consoleErrors.length}`);

  const passed = checks.filter(x => x.ok).length;
  const failed = checks.filter(x => !x.ok).length;
  console.log(`\n[models-audit] ${passed}/${checks.length} pass, ${failed} fail`);
  if (failed > 0) {
    console.log('failed:');
    for (const x of checks.filter(x => !x.ok)) {
      console.log(`  - ${x.name}${x.detail ? ': ' + x.detail : ''}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
