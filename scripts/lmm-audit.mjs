/**
 * Exhaustive LMM panel button audit.  Drives every interactive control
 * and reports anything that throws, errors silently, or leaves a stale
 * error banner.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 9222;
const log = (m) => console.log(`[lmm-audit ${new Date().toISOString().slice(11, 19)}] ${m}`);

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

  // Switch to LMM panel.
  const lmmClicked = await c.eval(`
    (() => {
      const btn = document.querySelector('button[data-panel="lmm"]')
        || Array.from(document.querySelectorAll('button[aria-label]')).find(b => /LMM|Lincoln/.test(b.getAttribute('aria-label')));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  check('switched to LMM panel', lmmClicked);
  await sleep(800);

  // Verify panel rendered.
  const hasHeading = await c.eval(`document.body.innerText.includes('Lincoln Manifold Method')`);
  check('LMM heading rendered', hasHeading);

  // Active toggle.
  const initiallyActive = await c.eval(`document.body.innerText.includes('Active') && !document.body.innerText.includes('Inactive')`);
  log(`initial state: ${initiallyActive ? 'Active' : 'Inactive'}`);

  // If not active, click toggle to activate.
  if (!initiallyActive) {
    const beforeToggle = c.exceptions.length;
    await c.eval(`
      (() => {
        const cards = Array.from(document.querySelectorAll('button'));
        const t = cards.find(b => b.style?.borderRadius === '12px' || /switch|toggle/i.test(b.getAttribute('role') ?? ''));
        // Fall back: the Active/Inactive toggle is a pill-shaped button
        t?.click();
      })()
    `);
    await sleep(500);
    check('Active toggle fires without exception', c.exceptions.length === beforeToggle);
  }

  // Find and click + New cycle button.
  let newCycleClicked = false;
  for (let i = 0; i < 6; i++) {
    newCycleClicked = await c.eval(`
      (() => {
        const b = Array.from(document.querySelectorAll('button')).find(b => /^\\+ New cycle$/.test(b.textContent.trim()));
        if (!b || b.disabled) return false;
        b.click();
        return true;
      })()
    `);
    if (newCycleClicked) break;
    await sleep(400);
  }
  check('+ New cycle button clickable', newCycleClicked);
  await sleep(400);

  // Modal should be open — input present + Cancel + Create buttons.
  const modalInputPresent = await c.eval(`
    !!document.querySelector('input[placeholder*="Cycle title"]')
  `);
  check('New cycle modal input present', modalInputPresent);

  const cancelBtnPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Cancel')
  `);
  check('Cancel button present', cancelBtnPresent);

  const createBtnPresent = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Create')
  `);
  check('Create button present', createBtnPresent);

  // Create with empty title should be disabled.
  const createDisabledWhenEmpty = await c.eval(`
    (() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create');
      return b?.disabled === true;
    })()
  `);
  check('Create button disabled when title empty', createDisabledWhenEmpty);

  // Type into the input.
  const cycleTitle = `audit-${Math.random().toString(36).slice(2, 8)}`;
  await c.eval(`
    (() => {
      const inp = document.querySelector('input[placeholder*="Cycle title"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '${cycleTitle}');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(200);

  const createEnabledAfterType = await c.eval(`
    !(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create')?.disabled)
  `);
  check('Create button enables after typing', createEnabledAfterType);

  // Click Create.
  const beforeCreate = c.exceptions.length;
  await c.eval(`
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create')?.click()
  `);
  await sleep(1500);
  check('Create fires without exception', c.exceptions.length === beforeCreate);

  // Modal should close, cycle list / editor should show.
  const modalClosed = await c.eval(`!document.querySelector('input[placeholder*="Cycle title"]')`);
  check('modal closes after Create', modalClosed);

  // Cycle should appear (in editor view or list).
  const cycleAppears = await c.eval(`document.body.innerText.includes('${cycleTitle}')`);
  check('created cycle appears in panel', cycleAppears);

  // Phase tabs / editor textarea present.
  const phaseTabsPresent = await c.eval(`
    /RAW|NODES|REFLECT|SYNTH/.test(document.body.innerText)
  `);
  check('phase tabs (RAW/NODES/REFLECT/SYNTH) present', phaseTabsPresent);

  const draftAreaPresent = await c.eval(`
    !!document.querySelector('textarea')
  `);
  check('draft textarea present in editor', draftAreaPresent);

  // Type into draft.
  if (draftAreaPresent) {
    const beforeDraft = c.exceptions.length;
    await c.eval(`
      (() => {
        const t = document.querySelector('textarea');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(t, 'Test RAW phase content for ${cycleTitle}');
        t.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    await sleep(300);
    check('typing in draft fires without exception', c.exceptions.length === beforeDraft);
  }

  // Find Save button — could be "Save" or "Save → NODES" etc.
  const saveBtnExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /^Save/.test(b.textContent.trim()))
  `);
  check('Save button present', saveBtnExists);

  // Click first Save button (not Save-and-advance).
  if (saveBtnExists) {
    const beforeSave = c.exceptions.length;
    await c.eval(`
      (() => {
        // Prefer the plain "Save" button, not Save → next.
        const btns = Array.from(document.querySelectorAll('button')).filter(b => /^Save/.test(b.textContent.trim()));
        const plain = btns.find(b => b.textContent.trim() === 'Save');
        (plain ?? btns[0])?.click();
      })()
    `);
    await sleep(1500);
    check('Save fires without exception', c.exceptions.length === beforeSave);

    const banner = await c.eval(`
      (() => {
        const a = document.querySelector('[role="alert"]');
        return a ? a.innerText.slice(0, 200) : null;
      })()
    `);
    check('no error banner after save', !banner, banner ?? '');
  }

  // Switch phase by clicking RAW → NODES.
  const nodesClickable = await c.eval(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /NODES/.test(b.textContent) && !/Save/.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  check('NODES phase tab clickable', nodesClickable);
  await sleep(500);

  // Close button — find "Close" or "×" closing the editor.
  const closeBtnExists = await c.eval(`
    Array.from(document.querySelectorAll('button')).some(b => /^(Close|✕|×)$/.test(b.textContent.trim()))
  `);
  log(`close button present: ${closeBtnExists}`);

  // ----- Cleanup: delete the cycle so we don't pollute state -----
  // We need to be in the cycle-list view first (Close the editor).
  if (closeBtnExists) {
    await c.eval(`
      Array.from(document.querySelectorAll('button')).find(b => /^Close$/.test(b.textContent.trim()))?.click()
    `);
    await sleep(800);
  }

  // Look for a delete affordance — could be ✕ near the title or a "Delete" button.
  // Cycle list cards typically have ✕ buttons.
  const deleteAvailable = await c.eval(`
    document.body.innerText.includes('${cycleTitle}')
  `);
  if (deleteAvailable) {
    // Override the confirm dialog so the test doesn't hang.
    await c.eval(`window.confirm = () => true`);
    // Find the row containing our cycle title, then click its delete button
    // (last button child or the one with title="Delete").
    const deleteResult = await c.eval(`
      (() => {
        const allButtons = Array.from(document.querySelectorAll('button[title="Delete"]'));
        const deleteBtn = allButtons.find(b => {
          let p = b.parentElement;
          for (let i = 0; i < 6 && p; i++) {
            if (p.textContent && p.textContent.includes('${cycleTitle}')) return true;
            p = p.parentElement;
          }
          return false;
        });
        if (!deleteBtn) {
          return { found: false, buttonCount: allButtons.length };
        }
        deleteBtn.click();
        return { found: true };
      })()
    `);
    log(`delete probe: ${JSON.stringify(deleteResult)}`);
    await sleep(1500);
    const stillThere = await c.eval(`document.body.innerText.includes('${cycleTitle}')`);
    check('delete cycle removes it from list', !stillThere);
  }

  // ----- summary -----
  const passed = checks.filter((x) => x.ok).length;
  const failed = checks.filter((x) => !x.ok).length;
  console.log(`\n[lmm-audit] ${passed}/${checks.length} pass, ${failed} fail`);
  if (failed > 0) {
    console.log('failed:');
    for (const x of checks.filter((x) => !x.ok)) {
      console.log(`  - ${x.name}${x.detail ? ': ' + x.detail : ''}`);
    }
  }
  console.log(`renderer exceptions: ${c.exceptions.length}`);
  console.log(`renderer console.error: ${c.consoleErrors.length}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
