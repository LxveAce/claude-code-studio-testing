/**
 * One-shot diagnostic — grab console errors, body text, and any vite
 * error overlay to figure out why the regression appeared.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9222;
const HOST = '127.0.0.1';

async function getCatalystPage() {
  const res = await fetch(`http://${HOST}:${PORT}/json/list`);
  const pages = await res.json();
  const ui = pages.find((p) => p.type === 'page' && p.title === 'Catalyst UI');
  if (!ui) throw new Error('No Catalyst UI page');
  return ui;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.consoleEvents = [];
    this.exceptions = [];
    this.ready = new Promise((resolve) => {
      this.ws.addEventListener('open', () => resolve());
    });
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : evt.data.toString());
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.consoleEvents.push(msg.params);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(msg.params);
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
    return r;
  }
}

(async () => {
  const ui = await getCatalystPage();
  const c = new CdpClient(ui.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Runtime.enable', {});

  // Force reload to get a fresh state.
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(4000);

  // Click HF
  await c.eval(`document.querySelector('button[data-panel="hf"]')?.click()`);
  await sleep(3000);

  // Look for visible app text
  const sample = await c.eval(`document.body.innerText.slice(0, 600)`);
  console.log('=== body text sample ===');
  console.log(sample.result?.value);

  // Vite overlay?
  const overlay = await c.eval(`
    document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message-body')?.innerText
    || document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message')?.innerText
    || null
  `);
  console.log('\n=== vite overlay ===');
  console.log(overlay.result?.value ?? '(none)');

  // React rendered button counts
  const counts = await c.eval(`
    JSON.stringify({
      panelButtons: document.querySelectorAll('[data-panel]').length,
      detailsButtons: Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Details').length,
      allButtons: document.querySelectorAll('button').length,
      hasHfPanel: document.body.innerText.includes('Hugging Face'),
      hasBrowseTab: document.body.innerText.includes('Browse'),
      hasSearchBar: !!document.querySelector('input[type="search"]'),
    })
  `);
  console.log('\n=== render counts ===');
  console.log(counts.result?.value);

  // Console events
  console.log('\n=== console events ===');
  for (const ev of c.consoleEvents.slice(-20)) {
    const txt = ev.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 250);
    console.log(`  [${ev.type}] ${txt}`);
  }

  // Exceptions
  console.log('\n=== exceptions ===');
  for (const ex of c.exceptions.slice(-5)) {
    console.log('  -', ex.exceptionDetails?.text, '@', ex.exceptionDetails?.url);
    console.log('   ', ex.exceptionDetails?.exception?.description?.split('\n')[0]);
  }

  c.ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
