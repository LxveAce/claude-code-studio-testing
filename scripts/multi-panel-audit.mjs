/**
 * Combined audit: Compact + Terminal Tabs + Settings + Sidebar.
 * Drives every panel-switch button + each panel's main interactive
 * controls.  Catches anything that throws in the renderer or surfaces
 * an error banner.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 9222;
const log = (m) => console.log(`[multi-audit ${new Date().toISOString().slice(11, 19)}] ${m}`);

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

  // ============================================================
  // SIDEBAR — every panel button switches without exception.
  // ============================================================
  log('=== SIDEBAR ===');
  const allPanels = ['terminal', 'commands', 'resources', 'files', 'cost', 'compact',
    'lmm', 'github', 'sync', 'auth', 'models', 'hf', 'settings'];
  for (const p of allPanels) {
    const before = c.exceptions.length;
    await c.eval(`document.querySelector('button[data-panel="${p}"]')?.click()`);
    await sleep(450);
    const banner = await c.eval(`
      (() => {
        const a = document.querySelector('[role="alert"]');
        return a ? a.innerText.slice(0, 120) : null;
      })()
    `);
    check(`sidebar ${p} switches without error`, c.exceptions.length === before && !banner,
      banner ? `banner=${banner}` : '');
  }

  // ============================================================
  // COMPACT panel.
  // ============================================================
  log('=== COMPACT ===');
  await c.eval(`document.querySelector('button[data-panel="compact"]')?.click()`);
  await sleep(700);

  const compactHeader = await c.eval(`document.body.innerText.includes('Compact')`);
  check('compact header rendered', compactHeader);

  const compactToggle = await c.eval(`
    !!Array.from(document.querySelectorAll('button')).find(b =>
      b.style && parseInt(b.style.width) === 44 && parseInt(b.style.height) === 24)
  `);
  check('compact toggle switch present', compactToggle);

  const stats = await c.eval(`
    /Input Tokens|Output Tokens|Total/.test(document.body.innerText)
  `);
  check('compact stats grid renders', stats);

  // ============================================================
  // TERMINAL TABS panel.
  // ============================================================
  log('=== TERMINAL TABS ===');
  await c.eval(`document.querySelector('button[data-panel="terminal"]')?.click()`);
  await sleep(700);

  // The + button and ▼ chevron.
  const plusBtn = await c.eval(`
    !!Array.from(document.querySelectorAll('button')).find(b =>
      b.getAttribute('aria-label') === 'New tab' || /^\\+$/.test(b.textContent.trim()))
  `);
  check('Terminal "+" new tab button present', plusBtn);

  const pickerBtn = await c.eval(`
    !!Array.from(document.querySelectorAll('button')).find(b =>
      b.getAttribute('aria-label') === 'Pick a profile')
  `);
  check('Terminal profile-picker "▼" button present', pickerBtn);

  // Click + which should open the picker (since both + and ▼ open picker now).
  if (plusBtn) {
    const before = c.exceptions.length;
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('aria-label') === 'New tab' || /^\\+$/.test(b.textContent.trim()))?.click()
    `);
    await sleep(700);
    check('+ button click fires without exception', c.exceptions.length === before);

    // Picker should be open with Claude default visible.
    const pickerOpen = await c.eval(`
      document.body.innerText.includes('Claude') &&
      (document.body.innerText.includes('Bundled default') || document.body.innerText.includes('Search profiles'))
    `);
    check('ProfilePicker dropdown opens with Claude default', pickerOpen);

    // Close picker via Escape.
    if (pickerOpen) {
      await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await sleep(400);
    }
  }

  // ============================================================
  // SETTINGS panel — verify sections render without errors.
  // ============================================================
  log('=== SETTINGS ===');
  await c.eval(`document.querySelector('button[data-panel="settings"]')?.click()`);
  await sleep(1200);

  // Look for major section headings (actual labels in the renderer).
  const accent = await c.eval(`document.body.innerText.includes('Accent Color')`);
  check('settings: Accent Color section renders', accent);

  const accessibility = await c.eval(`document.body.innerText.includes('Accessibility')`);
  check('settings: Accessibility section renders', accessibility);

  const hotkeys = await c.eval(`document.body.innerText.includes('Hotkeys')`);
  check('settings: Hotkeys section renders', hotkeys);

  // Danger Zone is rendered at the bottom of a scrollable panel — scroll
  // the container into view first, then check.
  await c.eval(`
    (() => {
      const root = document.scrollingElement || document.body;
      // Find any scrollable ancestor in the settings panel and scroll to
      // its bottom so DangerZoneSection mounts visibly.
      const scrollers = Array.from(document.querySelectorAll('*')).filter(el => {
        const cs = getComputedStyle(el);
        return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
      });
      for (const el of scrollers) el.scrollTop = el.scrollHeight;
      root.scrollTop = root.scrollHeight;
    })()
  `);
  await sleep(400);
  // Danger Zone heading uses textTransform: 'uppercase' so innerText
  // may render either form depending on browser; also accept the
  // section's distinctive buttons.
  const dangerZone = await c.eval(`
    /Danger\\s*Zone/i.test(document.body.innerText) ||
    /Reset user data|Uninstall Catalyst/.test(document.body.innerText)
  `);
  check('settings: Danger Zone section renders', dangerZone);

  const updater = await c.eval(`document.body.innerText.includes('Updat')`);
  check('settings: Updater section renders', updater);

  // Banner check after all navigation.
  const finalBanner = await c.eval(`
    (() => {
      const a = document.querySelector('[role="alert"]');
      return a ? a.innerText.slice(0, 200) : null;
    })()
  `);
  check('no global error banner after settings nav', !finalBanner, finalBanner ?? '');

  // ============================================================
  // CONSOLE / EXCEPTIONS summary.
  // ============================================================
  log('=== Console + exceptions summary ===');
  check('no exceptions thrown across all panels', c.exceptions.length === 0,
    c.exceptions.slice(-3).map(e => e.exceptionDetails?.text).join(' | '));
  check('no console.error across all panels', c.consoleErrors.length === 0,
    `count=${c.consoleErrors.length}`);

  const passed = checks.filter(x => x.ok).length;
  const failed = checks.filter(x => !x.ok).length;
  console.log(`\n[multi-audit] ${passed}/${checks.length} pass, ${failed} fail`);
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
