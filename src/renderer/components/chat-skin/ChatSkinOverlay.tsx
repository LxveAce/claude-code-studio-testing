import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Chat-skin overlay — ChatGPT/Claude.ai-style chat UI that sits on top of
 * the terminal pane. The xterm + PTY keep running underneath; the skin
 * subscribes to the same PTY data stream and provides its own input box.
 *
 * Toggle is per-pane (see `skin-prefs.ts`). When the user toggles off,
 * the xterm is revealed underneath with full history intact.
 *
 * Message parsing is intentionally simple:
 *   - User sends input via the textarea → append `{ role: 'user' }` message
 *     + write `text\r` to PTY.
 *   - PTY data arrives → strip ANSI; append to the LAST assistant message
 *     (creating one if the last message was a user turn).
 *   - First few echoed-back bytes after a user send are suppressed to hide
 *     the input echo from the assistant bubble.
 *
 * Limits + caveats: this is NOT a real LLM client; it's a presentation
 * skin over a raw PTY. Some CLIs (Aider, gemini-cli) print prompts and
 * tool-use blocks that won't parse cleanly into "messages." The skin is
 * a UX option; users who want literal terminal output keep it toggled
 * off (the default).
 */

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Accumulated text, ANSI-stripped. */
  text: string;
  timestamp: number;
}

interface Props {
  paneId: string;
  /** Visible state — when false, the overlay is hidden (xterm shows). */
  visible: boolean;
  /** Click handler for the "exit skin" button. */
  onToggleOff: () => void;
}

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 100_000; // safety cap per message
const ECHO_SUPPRESS_WINDOW_MS = 1500;

export function ChatSkinOverlay({ paneId, visible, onToggleOff }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Last user-sent text + when, used to suppress the immediate echo from
   *  the assistant bubble. Set when the user sends; cleared when an
   *  unrelated chunk arrives or after a short window. */
  const lastSentRef = useRef<{ text: string; at: number } | null>(null);

  /**
   * Subscribe to PTY data. We always subscribe (visible or not) so the
   * skin's message history stays in sync with the actual session — that
   * way toggling on doesn't show an empty chat.
   */
  useEffect(() => {
    const unsub = window.electronAPI.terminal.onData(paneId, (data) => {
      appendAssistantChunk(data);
    });
    return () => {
      try {
        unsub();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  /** Append a chunk of PTY output to the latest assistant message, after
   *  ANSI stripping + echo suppression. */
  const appendAssistantChunk = useCallback((rawData: string) => {
    let cleaned = stripAnsi(rawData);
    // Drop a leading carriage-return that's just terminal cursor behavior.
    cleaned = cleaned.replace(/^\r/, '');
    if (!cleaned) return;

    // Echo suppression: if the user just sent something, the CLI usually
    // echoes it right back. Trim a leading-substring match.
    const last = lastSentRef.current;
    if (last && Date.now() - last.at < ECHO_SUPPRESS_WINDOW_MS) {
      // Match the user's text against the start of the incoming chunk
      // (ignoring leading whitespace + the CR we already trimmed).
      const startsWithSent = cleaned.startsWith(last.text);
      if (startsWithSent) {
        cleaned = cleaned.slice(last.text.length).replace(/^[\r\n]+/, '');
      }
      // Whether we trimmed or not, drop the suppression window once any
      // chunk arrives — the echo only happens once per send.
      lastSentRef.current = null;
    }
    if (!cleaned) return;

    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        // Append to the existing assistant message (cap length).
        const nextText = (lastMsg.text + cleaned).slice(0, MAX_MESSAGE_CHARS);
        const updated: ChatMessage = { ...lastMsg, text: nextText };
        return [...prev.slice(0, -1), updated];
      }
      // Otherwise start a new assistant message.
      const next: ChatMessage = {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        text: cleaned.slice(0, MAX_MESSAGE_CHARS),
        timestamp: Date.now(),
      };
      const combined = [...prev, next];
      return combined.length > MAX_MESSAGES
        ? combined.slice(combined.length - MAX_MESSAGES)
        : combined;
    });
  }, []);

  /** Scroll to bottom when messages change OR when the overlay becomes
   *  visible (so the user lands on the latest content). */
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, visible]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;

    // Append user message.
    setMessages((prev) => {
      const next: ChatMessage = {
        id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        text,
        timestamp: Date.now(),
      };
      const combined = [...prev, next];
      return combined.length > MAX_MESSAGES
        ? combined.slice(combined.length - MAX_MESSAGES)
        : combined;
    });

    // Mark for echo suppression on the next chunk.
    lastSentRef.current = { text, at: Date.now() };

    // Write to the PTY. `\r` is the conventional submit char for Claude
    // CLI + most interactive REPLs.
    try {
      window.electronAPI.terminal.sendInput(paneId, text + '\r');
    } catch {
      // PTY missing — show a system-style notice in the chat.
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          text: '⚠ Could not deliver to the terminal (PTY unavailable).',
          timestamp: Date.now(),
        },
      ]);
    }

    setDraft('');
    // Re-focus the textarea so the user can keep typing.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draft, paneId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends. Shift+Enter inserts a newline (standard chat UX).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        // Subtle accent edge so users can tell skin is active.
        boxShadow: 'inset 0 1px 0 var(--border-active), inset 0 -1px 0 var(--border-active)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: 'var(--shadow-glow)',
            }}
          />
          Chat skin active
        </div>
        <button
          onClick={onToggleOff}
          title="Show terminal (Ctrl+Shift+T)"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Terminal view
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              margin: 'auto',
              color: 'var(--text-secondary)',
              fontSize: 13,
              textAlign: 'center',
              maxWidth: 360,
              lineHeight: 1.6,
            }}
          >
            <div
              style={{
                fontSize: 32,
                marginBottom: 12,
                background: 'var(--accent-gradient)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: 700,
              }}
            >
              ✦
            </div>
            <div>Type a message below to start a conversation with the active CLI.</div>
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
              Same PTY underneath — toggle "Terminal view" to switch.
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {/* Input bar */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: 12,
          background: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '8px 10px',
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message…  (Enter to send, Shift+Enter for newline)"
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: 22,
              maxHeight: 180,
              lineHeight: 1.5,
            }}
            // Simple auto-grow: grow with content height up to maxHeight.
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = '22px';
              el.style.height = Math.min(180, el.scrollHeight) + 'px';
            }}
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: draft.trim() ? 'var(--accent)' : 'var(--gauge-grey)',
              color: 'white',
              fontSize: 12,
              fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
              opacity: draft.trim() ? 1 : 0.5,
              transition: 'all var(--transition-fast)',
              flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: 'var(--radius-lg)',
          background: isUser
            ? 'var(--accent-gradient)'
            : 'var(--bg-secondary)',
          color: isUser ? 'white' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border)',
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: isUser
            ? 'inherit'
            : '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

/**
 * Minimal ANSI escape stripper. Removes CSI / OSC / bare-ESC sequences so
 * the chat UI renders clean text. Same regex as pty-key-interceptor;
 * duplicated here so the chat skin works without that module loaded.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[PX^_].*?\x1b\\/g, '');
}
