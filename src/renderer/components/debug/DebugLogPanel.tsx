import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DebugLogEntry, DebugLogKind, DebugLogStatus } from '../../../shared/types';

/**
 * DebugLogPanel — live tail of every event captured by the main-side
 * DebugLogService. Shows newest entries at the top, scrolling away as
 * older ones come in.
 *
 * Filters: by kind (multi-select). Search: substring match against
 * source + JSON-stringified payload.
 *
 * Controls: enable/disable toggle, clear, open log file in OS default
 * editor.
 *
 * Testing-only panel. Lives on the `debug-logs` branch.
 */

const ALL_KINDS: DebugLogKind[] = [
  'ipc-handle',
  'ipc-send',
  'pty-event',
  'updater',
  'service-init',
  'service-call',
  'cli-bootstrap',
  'user-interaction',
  'unhandled',
  'note',
];

const KIND_COLORS: Record<DebugLogKind, string> = {
  'ipc-handle': '#7dd3fc',
  'ipc-send': '#a5b4fc',
  'pty-event': '#86efac',
  'updater': '#fcd34d',
  'service-init': '#c4b5fd',
  'service-call': '#e9d5ff',
  'cli-bootstrap': '#fdba74',
  'user-interaction': '#f9a8d4',
  'unhandled': '#fca5a5',
  'note': '#94a3b8',
};

const MAX_ENTRIES = 1000;

export function DebugLogPanel() {
  const [status, setStatus] = useState<DebugLogStatus | null>(null);
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [kindFilter, setKindFilter] = useState<Set<DebugLogKind>>(new Set(ALL_KINDS));
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.electronAPI.debug.status();
      setStatus(s);
    } catch {
      // debug API missing — render placeholder
      setStatus(null);
    }
  }, []);

  const loadTail = useCallback(async () => {
    try {
      const tail = await window.electronAPI.debug.tail(200);
      setEntries(tail);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadTail();
  }, [loadStatus, loadTail]);

  // Subscribe to live entries; prepend each, capped at MAX_ENTRIES.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    try {
      unsub = window.electronAPI.debug.onEntry((entry) => {
        if (pausedRef.current) return;
        setEntries((prev) => {
          const next = [entry, ...prev];
          return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
        });
      });
    } catch {
      // ignore — debug API not present
    }
    return () => {
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, []);

  const toggleEnabled = async () => {
    if (!status) return;
    try {
      const next = await window.electronAPI.debug.setEnabled(!status.settingsEnabled);
      setStatus(next);
    } catch { /* ignore */ }
  };

  const handleClear = async () => {
    try {
      await window.electronAPI.debug.clear();
      setEntries([]);
    } catch { /* ignore */ }
  };

  const handleOpenLog = async () => {
    try { await window.electronAPI.debug.openLog(); } catch { /* ignore */ }
  };

  const toggleKind = (k: DebugLogKind) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!kindFilter.has(e.kind)) return false;
      if (!needle) return true;
      const hay =
        e.source.toLowerCase() +
        ' ' +
        (e.payload != null ? JSON.stringify(e.payload).toLowerCase() : '') +
        ' ' +
        (e.error ? e.error.toLowerCase() : '');
      return hay.includes(needle);
    });
  }, [entries, kindFilter, search]);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Debug Log
      </h3>

      {/* Status + global controls */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {status === null
            ? 'Debug API not available on this build.'
            : status.enabled
              ? <>Logging <strong style={{ color: '#86efac' }}>ON</strong>{status.envForced ? ' (DEBUG_DUMP=1)' : status.devMode ? ' (dev mode)' : ''}</>
              : <>Logging <strong style={{ color: '#fca5a5' }}>OFF</strong></>}
        </div>
        {status && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, wordBreak: 'break-all' }}>
            {status.logPath}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={toggleEnabled} disabled={!status || status.envForced || status.devMode} style={btnStyle}>
            {status?.settingsEnabled ? 'Disable persistent' : 'Enable persistent'}
          </button>
          <button type="button" onClick={() => setPaused((p) => !p)} style={btnStyle}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button type="button" onClick={handleClear} style={btnStyle}>Clear</button>
          <button type="button" onClick={handleOpenLog} style={btnStyle}>Open log file</button>
        </div>
      </div>

      {/* Filters */}
      <div style={cardStyle}>
        <input
          type="text"
          placeholder="Search source / payload / error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchStyle}
        />
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ALL_KINDS.map((k) => {
            const on = kindFilter.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                title={on ? `Hide ${k}` : `Show ${k}`}
                style={{
                  ...kindChipStyle,
                  background: on ? KIND_COLORS[k] : 'transparent',
                  color: on ? '#0f172a' : KIND_COLORS[k],
                  border: `1px solid ${KIND_COLORS[k]}`,
                  opacity: on ? 1 : 0.45,
                }}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tail */}
      <div style={{ ...cardStyle, flex: 1, overflow: 'auto', padding: 0 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 16, fontSize: 11, color: 'var(--text-muted)' }}>
            No entries match the current filter.
          </div>
        )}
        {filtered.map((e, i) => (
          <div key={`${e.ts}-${i}`} style={entryRowStyle}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {e.iso.slice(11, 23)}
              </span>
              <span
                style={{
                  ...kindChipStyle,
                  background: KIND_COLORS[e.kind],
                  color: '#0f172a',
                  border: 'none',
                  padding: '1px 6px',
                  fontSize: 9,
                }}
              >
                {e.kind}
              </span>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                {e.source}
              </span>
              {typeof e.durationMs === 'number' && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.durationMs} ms</span>
              )}
            </div>
            {e.error && (
              <pre style={{ ...payloadStyle, color: '#fca5a5' }}>{e.error}</pre>
            )}
            {e.payload != null && (
              <pre style={payloadStyle}>{safeStringify(e.payload)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const accentBarStyle: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient)',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg-primary)',
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid var(--border, rgba(255,255,255,0.08))',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '4px 10px',
  fontSize: 11,
  borderRadius: 4,
  cursor: 'pointer',
};

const searchStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '6px 10px',
  fontSize: 11,
  borderRadius: 4,
  outline: 'none',
};

const kindChipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  borderRadius: 999,
  cursor: 'pointer',
  userSelect: 'none',
};

const entryRowStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--border, rgba(255,255,255,0.04))',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
};

const payloadStyle: React.CSSProperties = {
  marginTop: 4,
  marginLeft: 8,
  fontSize: 10,
  color: 'var(--text-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 200,
  overflow: 'auto',
  background: 'rgba(0,0,0,0.15)',
  padding: '4px 6px',
  borderRadius: 3,
};
