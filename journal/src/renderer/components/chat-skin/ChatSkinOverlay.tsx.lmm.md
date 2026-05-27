# LMM: src/renderer/components/chat-skin/ChatSkinOverlay.tsx

> File: `src/renderer/components/chat-skin/ChatSkinOverlay.tsx` · LOC: ~330 · Role: ChatGPT/Claude.ai-style chat UI overlaid on a terminal pane; same PTY underneath, presentation skin only.

## Phase 1: RAW

The user asked for "a skin that can be layered over the terminal" with the look of "the other pre-packaged UIs for AI" — i.e., chat bubbles, a clean input box at the bottom, no command-line clutter visible. Toggleable per-pane.

The hard call is **what "skin" actually means here**. Two extremes:

1. **Real chat client**: parse the CLI's protocol (Claude CLI's JSON streaming format, Aider's diff blocks), render structured messages with code highlighting, tool-use UI, etc. Requires per-CLI adapter code, lots of edge cases.
2. **Presentation skin**: same PTY underneath; the skin is just a different way to type input + view output. No deep parsing. Toggle off → terminal-as-normal.

I chose option 2 because:
- It's the user's stated framing ("a skin layered over") — implying presentation, not protocol-aware.
- Per-CLI adapters would balloon scope; we already have 4 providers in the catalog, more coming.
- Honest about limits: this is NOT a real LLM client. It's a UX option for users who prefer the chat aesthetic.

The implementation: subscribe to the same `terminal.onData` IPC the xterm uses, accumulate output into "assistant" messages, render as bubbles. User input goes through `terminal.sendInput` (same channel xterm uses). The xterm stays mounted underneath the overlay (`visibility: hidden`) so toggling off restores the full session including scrollback.

The trickiest piece is **echo suppression**. When the user types "hello" + Enter, the CLI echoes "hello" back to stdout before responding. Without suppression, the assistant bubble would start with the user's own text. Mitigation: `lastSentRef` stores what we sent + when. The first chunk arriving within 1.5s gets its leading-substring match against the sent text stripped.

This is fragile by design — perfect parsing isn't possible without per-CLI knowledge. The skin is "good enough"; users who want literal terminal text toggle it off.

## Phase 2: NODES

### Node 1: Same PTY underneath; skin is presentation only
The xterm stays mounted (visibility: hidden) when the skin is on. PTY data flows to both subscriptions. Why it matters: toggling off doesn't lose history; toggling on doesn't reset session.

### Node 2: Subscribe always, even when not visible
`useEffect(() => terminal.onData(paneId, ...))` runs regardless of `visible` prop. Why it matters: switching to the skin shows the recent assistant output rather than an empty pane.

### Node 3: Echo suppression via `lastSentRef`
When user sends, record text + timestamp. First chunk within 1.5s gets the leading-substring match removed. Why it matters: hides the input echo from the assistant bubble.

### Node 4: Append-to-last-assistant accumulation
Sequential PTY chunks go into the LAST assistant message (one message per response). New "assistant" message only created when the previous message was a "user" turn. Why it matters: a single response renders as one bubble, not 50 fragments.

### Node 5: MAX_MESSAGES (200) + MAX_MESSAGE_CHARS (100k)
Bounded memory for long sessions. Why it matters: chat overlay can run for hours; without caps, JS heap grows unbounded.

### Node 6: Enter sends, Shift+Enter newline
Standard chat keyboard. Why it matters: matches user expectations from ChatGPT / Claude.ai / Slack.

### Node 7: User-bubble uses accent gradient; assistant-bubble uses monospace
Visual distinction beyond left/right alignment. Why it matters: monospace assistant output preserves any meaningful indentation from the CLI; gradient user bubble matches the theme.

### Node 8: Toggle button surfaces are different on/off
When off: small floating "✦ Chat" button top-right of the xterm container. When on: full chat-skin header with "Terminal view" button. Why it matters: when xterm is on, we don't want to clutter it with skin chrome; when skin is on, the header is informational.

### Node 9: `pre-wrap` + `word-break: break-word` on bubbles
Preserves CLI whitespace (indentation, tables) while wrapping long lines. Why it matters: ASCII art / wide CLI output renders correctly.

## Phase 3: REFLECT

### Core insight
**The skin is a presentation layer over a transparent transport.** Every PTY byte still flows; the skin renders it differently. There's no "abstraction over CLIs" because every CLI is the same to us: bytes in, bytes out.

### Resolved tensions
- **Node 2 (always subscribe) vs Node 5 (memory caps)**: always-subscribed means we accumulate state even when invisible. The caps bound that growth. A 200-message × 100KB cap = 20MB worst case per pane, acceptable.
- **Node 3 (echo suppression) vs noisy CLIs**: some CLIs (Aider) print their input echo with ANSI styling (bold, color). Our stripAnsi runs first, so the suppression match operates on plain text — still works.
- **Node 4 (accumulate vs split)**: long assistant responses with internal pauses (Claude streaming) get one bubble. If a future version wants per-token streaming UX with a typing cursor, this is the place to add it.

### Hidden assumptions
- Assumed: CLI output is roughly UTF-8 plaintext after ANSI stripping. Challenge: it usually is. Box-drawing characters and other Unicode pass through fine; raw binary doesn't (but a CLI shouldn't emit raw binary in interactive mode).
- Assumed: `\r` is the right submit character. Challenge: Claude CLI accepts \r. Some shells expect \n. We could send `\r\n` defensively; haven't because it'd cause double-submit on shells that interpret \r as submit and \n as newline.
- Assumed: the user understands "this is a skin, not a real chat client." Challenge: someone may report that "the chat doesn't render markdown" or "code highlighting is broken" — expected, documented in the empty-state copy ("Same PTY underneath").

## Phase 4: SYNTHESIZE

### What this file should become
A stable presentation layer. The interesting follow-ups are all opt-in features rather than bug fixes:

### Actionable items
- [ ] Code-block detection (text wrapped in ``` ``` or 4-space indent) → render with monaco/prism for syntax highlighting.
- [ ] Streaming cursor (a blinking ▍ on the latest assistant message) to make incoming text feel live.
- [ ] Per-pane "model" badge in the header showing which CLI the user is talking to (we know from ModelDefinition).
- [ ] Slash-command palette — `/clear`, `/history`, etc. Don't reinvent terminal — keep these scoped to chat-UX commands.
- [ ] Keyboard shortcut: Ctrl+Shift+T to toggle the skin from inside xterm.
- [ ] Aider-specific: detect diff blocks ("```diff") and render with red/green highlighting.
- [ ] Claude-specific: detect tool-use JSON blocks and render compactly.

### Risks
- Users may believe the skin gives them features that don't exist (tool-use UI, message editing, regenerate). Need clear empty-state messaging.
- Echo suppression is fragile — a CLI version change can break it. Worst case: extra echo text in the assistant bubble. Recoverable by the user toggling to terminal view.
- The `\r` submit may not work for every CLI. If users report "my CLI doesn't see the input," consider making the submit char configurable per provider.
