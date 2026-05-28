/**
 * Standalone test of the hf:download IPC.  Initiates a small file
 * download and watches for progress events arriving on the renderer.
 * Cancels after seeing one or two progress events (no full transfer).
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 9222;

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
    this.ready = new Promise((resolve) => this.ws.addEventListener('open', () => resolve()));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data.toString());
      if (m.id != null && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
}

(async () => {
  const ui = await getPage();
  const c = new Cdp(ui.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Runtime.enable', {});

  // Install a progress-event collector on window.
  await c.eval(`
    window.__hfProgress = [];
    if (!window.__hfUnsub) {
      window.__hfUnsub = window.electronAPI.hf.onDownloadProgress((ev) => {
        window.__hfProgress.push(ev);
      });
    }
  `);

  // Trigger a small download: README.md from a known repo (~few KB).
  const result = await c.eval(`
    window.electronAPI.hf.download('bartowski/Llama-3.2-3B-Instruct-GGUF', 'README.md')
      .then(r => r)
      .catch(e => ({ ok: false, error: e.message }))
  `, true);
  console.log('download result:', JSON.stringify(result, null, 2));

  await sleep(500);
  const progress = await c.eval(`window.__hfProgress`);
  console.log(`\nprogress events received: ${progress.length}`);
  for (const ev of progress.slice(0, 10)) {
    console.log('  -', JSON.stringify(ev));
  }
  if (progress.length > 10) console.log(`  ... and ${progress.length - 10} more`);

  const ok = result.ok === true;
  const hadProgress = progress.length > 0;
  const sawDone = progress.some((e) => e.done);
  console.log('');
  console.log(`download ok: ${ok}`);
  console.log(`progress events: ${hadProgress}`);
  console.log(`done event: ${sawDone}`);
  process.exit(ok && hadProgress && sawDone ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
