import { ipcMain, webContents } from 'electron';
import { DebugLogService } from './debug-log-service';

/**
 * Patch electron's ipcMain.handle + ipcMain.on so every IPC call is
 * logged via DebugLogService. Idempotent — call once during main
 * process startup.
 *
 * For .handle: logs request args + duration + return value (or error).
 * For .on: logs request args. No response since .on is fire-and-forget.
 *
 * For renderer-bound `webContents.send(channel, ...args)` we wrap
 * webContents prototypes once per BrowserWindow creation — see
 * `wrapWebContentsSend()` below; index.ts calls it after createWindow.
 *
 * Heads-up: this is testing-only. Payloads can include user-typed
 * text and auth tokens. The `debug-logs` branch on the testing
 * remote is the only place this should live.
 */

type IpcMainHandleCb = Parameters<typeof ipcMain.handle>[1];
type IpcMainOnListener = Parameters<typeof ipcMain.on>[1];

let installed = false;

/** Call once at app start. Returns true if it actually patched. */
export function installIpcInstrumentation(): boolean {
  if (installed) return false;
  installed = true;

  const debug = DebugLogService.instance();

  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);

  ipcMain.handle = ((channel: string, listener: IpcMainHandleCb): void => {
    originalHandle(channel, async (event, ...args: unknown[]) => {
      const start = Date.now();
      const safeArgs = sanitizeArgs(args);
      try {
        const result = await listener(event, ...args);
        debug.log({
          kind: 'ipc-handle',
          source: `ipc:${channel}`,
          payload: { args: safeArgs, result: shrink(result) },
          durationMs: Date.now() - start,
        });
        return result;
      } catch (err) {
        debug.log({
          kind: 'ipc-handle',
          source: `ipc:${channel}`,
          payload: { args: safeArgs },
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
        throw err;
      }
    });
  }) as typeof ipcMain.handle;

  ipcMain.on = ((channel: string, listener: IpcMainOnListener): typeof ipcMain => {
    return originalOn(channel, (event, ...args: unknown[]) => {
      debug.log({
        kind: 'ipc-handle',
        source: `ipc-on:${channel}`,
        payload: { args: sanitizeArgs(args) },
      });
      listener(event, ...args);
    });
  }) as typeof ipcMain.on;

  debug.log({
    kind: 'service-init',
    source: 'ipc-instrumentation',
    payload: { installed: true },
  });
  return true;
}

/**
 * Wrap webContents.send across all current + future renderer processes
 * so main → renderer broadcasts get logged too.
 */
export function wrapWebContentsSend(): void {
  const debug = DebugLogService.instance();
  const wrapOne = (wc: Electron.WebContents) => {
    const original = wc.send.bind(wc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wc as any).send = (channel: string, ...args: unknown[]) => {
      debug.log({
        kind: 'ipc-send',
        source: `send:${channel}`,
        payload: { args: sanitizeArgs(args), wcId: wc.id },
      });
      return original(channel, ...args);
    };
  };
  // Wrap existing webContents
  webContents.getAllWebContents().forEach(wrapOne);
  // Wrap new ones as they're created
  // Note: there's no 'web-contents-created' event on webContents itself;
  // electron emits it on app. The wrapping is best-effort here — main's
  // index.ts already does app.on('web-contents-created', ...) for other
  // hardening, so it can call wrapOne(contents) from there.
}

/**
 * Strip secrets and shrink huge payloads before they hit the log file.
 *
 * Heuristics:
 *   - drop anything whose key matches /token|secret|password|cred|pat/i
 *   - truncate strings >1000 chars
 *   - max recursion depth 4
 */
function sanitizeArgs(args: unknown[]): unknown {
  return args.map((a) => sanitize(a, 0));
}

function sanitize(value: unknown, depth: number): unknown {
  if (depth > 4) return '[too-deep]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 1000 ? value.slice(0, 1000) + '…[trunc]' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const k of Object.keys(value as Record<string, unknown>)) {
      if (count++ > 50) {
        out['[truncated]'] = '...';
        break;
      }
      if (/token|secret|password|cred|pat/i.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = sanitize((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return String(value);
}

function shrink(value: unknown): unknown {
  return sanitize(value, 0);
}
