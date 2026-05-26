import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * DebugLogService — captures structured events from every layer of the
 * app (IPC, PTY, updater, user clicks) into a JSONL file plus an
 * in-memory ring buffer for the live-tail Debug Log panel.
 *
 * Only enabled when:
 *   - env var DEBUG_DUMP=1 at app start, OR
 *   - settings.debugLogEnabled === true (persisted in
 *     <userData>/debug-log-settings.json), OR
 *   - app.isPackaged === false (always on in dev)
 *
 * Output: <userData>/debug-dump.jsonl, rotated when it exceeds
 * 1 MB (kept as debug-dump.jsonl.1; previous .1 is deleted).
 *
 * Privacy: this is testing-only. It logs IPC args verbatim, which may
 * include user-typed text, sign-in flows, PATs, etc. NEVER ship this
 * branch to public users. Branch is `debug-logs` on the testing remote.
 */

export type DebugLogKind =
  | 'ipc-handle'      // ipcMain.handle invocation (request → response)
  | 'ipc-send'        // main → renderer event sent
  | 'pty-event'       // PTY spawn/data/exit/ready
  | 'updater'         // electron-updater state transition
  | 'service-init'    // service constructor / init
  | 'service-call'    // arbitrary service method enter/exit
  | 'cli-bootstrap'   // CliService bootstrap step
  | 'user-interaction'// renderer-side click / keypress / panel switch
  | 'unhandled'       // uncaught exception / promise rejection
  | 'note';           // free-form developer note

export interface DebugLogEntry {
  /** epoch ms */
  ts: number;
  /** Human-readable ISO time (UTC). */
  iso: string;
  /** Category. */
  kind: DebugLogKind;
  /** Where it came from — e.g. "PtyRegistry", "UpdaterService", "ipc:terminal:spawn". */
  source: string;
  /** Structured payload — must be JSON-serializable. */
  payload?: unknown;
  /** Optional duration in ms (for ipc-handle / service-call exits). */
  durationMs?: number;
  /** Optional error message if the operation failed. */
  error?: string;
}

const SETTINGS_FILE = 'debug-log-settings.json';
const LOG_FILE = 'debug-dump.jsonl';
const LOG_ROLL_THRESHOLD = 1024 * 1024; // 1 MB
const RING_BUFFER_SIZE = 500;

interface DebugLogSettings {
  enabled: boolean;
}

const DEFAULT_SETTINGS: DebugLogSettings = {
  enabled: false,
};

export class DebugLogService extends EventEmitter {
  private static _instance: DebugLogService | null = null;

  static instance(): DebugLogService {
    if (!this._instance) this._instance = new DebugLogService();
    return this._instance;
  }

  private settings: DebugLogSettings;
  private settingsPath: string;
  private logPath: string;
  /** Most recent entries kept in memory for the live-tail UI. */
  private ringBuffer: DebugLogEntry[] = [];
  /** Cached `enabled` resolution (env + settings) to avoid recomputing per log call. */
  private effectiveEnabled: boolean;

  private constructor() {
    super();
    this.setMaxListeners(50);
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.logPath = path.join(app.getPath('userData'), LOG_FILE);
    this.settings = this.readSettings();
    this.effectiveEnabled = this.computeEnabled();

    // Capture unhandled exceptions + rejections from the main process.
    // These are the bugs we most want to catch in a debug build.
    process.on('uncaughtException', (err) => {
      this.log({
        kind: 'unhandled',
        source: 'process',
        payload: { type: 'uncaughtException' },
        error: err?.stack ?? String(err),
      });
    });
    process.on('unhandledRejection', (reason) => {
      this.log({
        kind: 'unhandled',
        source: 'process',
        payload: { type: 'unhandledRejection' },
        error: reason instanceof Error ? reason.stack : String(reason),
      });
    });

    this.log({
      kind: 'service-init',
      source: 'DebugLogService',
      payload: {
        effectiveEnabled: this.effectiveEnabled,
        envDebugDump: process.env.DEBUG_DUMP === '1',
        settingsEnabled: this.settings.enabled,
        isPackaged: app.isPackaged,
        logPath: this.logPath,
      },
    });
  }

  /** Public: is the logger currently writing? */
  isEnabled(): boolean {
    return this.effectiveEnabled;
  }

  /** Public: read current settings. */
  getSettings(): DebugLogSettings {
    return { ...this.settings };
  }

  /** Public: change the persistent enabled flag. Effective immediately. */
  setEnabled(enabled: boolean): DebugLogSettings {
    this.settings.enabled = enabled;
    this.writeSettings();
    const previously = this.effectiveEnabled;
    this.effectiveEnabled = this.computeEnabled();
    this.log({
      kind: 'note',
      source: 'DebugLogService',
      payload: { event: 'setEnabled', from: previously, to: this.effectiveEnabled },
    });
    return { ...this.settings };
  }

  /** Public: append one entry. No-op if disabled (except service-init). */
  log(partial: Omit<DebugLogEntry, 'ts' | 'iso'>): void {
    if (!this.effectiveEnabled && partial.kind !== 'service-init') return;
    const now = Date.now();
    const entry: DebugLogEntry = {
      ts: now,
      iso: new Date(now).toISOString(),
      ...partial,
    };
    this.appendToRing(entry);
    this.appendToFile(entry);
    this.emit('entry', entry);
  }

  /** Public: return the in-memory tail (most recent first). */
  getTail(count = 100): DebugLogEntry[] {
    const slice = this.ringBuffer.slice(-count);
    return slice.reverse();
  }

  /** Public: clear file + ring buffer. */
  clear(): void {
    this.ringBuffer = [];
    try {
      fs.writeFileSync(this.logPath, '');
    } catch {
      // file write failure non-fatal
    }
    this.log({ kind: 'note', source: 'DebugLogService', payload: { event: 'clear' } });
  }

  /** Public: absolute path to the log file (for "Open log" buttons). */
  getLogPath(): string {
    return this.logPath;
  }

  // ----- internals -----

  private computeEnabled(): boolean {
    if (process.env.DEBUG_DUMP === '1') return true;
    if (!app.isPackaged) return true;
    return this.settings.enabled;
  }

  private appendToRing(entry: DebugLogEntry): void {
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > RING_BUFFER_SIZE) {
      this.ringBuffer.splice(0, this.ringBuffer.length - RING_BUFFER_SIZE);
    }
  }

  private appendToFile(entry: DebugLogEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logPath, line);
      this.rotateIfNeeded();
    } catch {
      // Filesystem errors here would be noisy and counter-productive
      // (logging a logging failure). Drop silently — ring buffer still
      // captured it for live tail.
    }
  }

  private rotateIfNeeded(): void {
    try {
      const stat = fs.statSync(this.logPath);
      if (stat.size <= LOG_ROLL_THRESHOLD) return;
      const rolled = `${this.logPath}.1`;
      try {
        fs.unlinkSync(rolled);
      } catch {
        // no prior .1 file
      }
      fs.renameSync(this.logPath, rolled);
      fs.writeFileSync(this.logPath, '');
    } catch {
      // ignore rotation failures
    }
  }

  private readSettings(): DebugLogSettings {
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private writeSettings(): void {
    try {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch {
      // persistence failure is non-fatal; runtime state still updated
    }
  }
}

/**
 * Convenience helper for instrumenting a service-call boundary:
 *   const end = debug.beginCall('CliService.install', { arg });
 *   try { ... } finally { end({ ok: true }); }
 */
export function beginCall(
  source: string,
  inputPayload?: unknown
): (outputPayload?: unknown, error?: string) => void {
  const start = Date.now();
  return (outputPayload, error) => {
    DebugLogService.instance().log({
      kind: 'service-call',
      source,
      payload: { in: inputPayload, out: outputPayload },
      durationMs: Date.now() - start,
      error,
    });
  };
}
