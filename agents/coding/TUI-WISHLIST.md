# TUI Wishlist

Tracked issues, ideas, and aspirations for the tentickle terminal UI.

## Critical: Alternate Screen Mode

**Problem**: Ink's inline mode can't handle a chat UI. The dynamic area height
is unbounded — long streaming responses overwrite console.log scrollback above.
Capping streaming height is a band-aid, not a fix.

**Solution**: Switch to alternate screen buffer (`alternateScreen: true`, already
supported in `createTUI`). This means:

- Own the full terminal. No scrollback pollution, no overwrite bugs.
- Implement a scrollable message area within a fixed-height viewport.
- Messages rendered within our viewport, not relying on terminal scrollback.
- Input bar + footer pinned to the bottom (fixed position).
- Streaming content fills the viewport, scrolls naturally.

**Prior art**: Claude Code, Lazygit, btop — all use alternate screen with their
own layout management. This is the standard pattern for serious TUIs.

**Ink support**: Ink's `Box` supports `height`, `flexGrow`, `overflow`. Combined
with alternate screen, we can build a fixed layout with a scrollable message
pane. May need a scroll hook or use `ink-scrollbar`/custom.

**Status**: Not started. Current inline mode works for short conversations.

## Ink `<Static>` — Broken or Misunderstood

We tried `<Static items={history}>` multiple times. Items never render visibly.
Possible causes:

- Push-to-bottom (`\n.repeat(rows)`) interferes with Static's positioning
- Static renders items above Ink's managed area, but they end up in the
  newline padding zone (invisible, scrolled past top)
- Static has a bug with items added after initial render in certain configs

**TODO**: Build an isolated Ink test app (no agentick, no hooks) that just uses
Static with a button to add items. Verify Static works at all in our setup.
If it does, the issue is in our integration. If not, it's an Ink bug or
incompatibility with our terminal/push-to-bottom approach.

## Banner Art

Current: simple ASCII tentacle with watch. Functional but small.

### Ideas

- **Unicode block mosaics**: Use U+2580-259F (half blocks, quadrants) for
  2x vertical resolution. Much sharper than plain ASCII. Works in any
  Unicode terminal.
- **Chafa**: Image-to-terminal renderer. Can output Unicode mosaics, Sixels,
  Kitty protocol, iTerm2 protocol. Available as CLI (`chafa`) or WASM
  (`chafa-wasm` npm package). Could render a real octopus image.
- **Kitty/iTerm2 image protocol**: Render actual PNG/SVG in supported
  terminals. Highest quality, limited compatibility.
- **Landscape orientation**: Wider, shorter banner. ~80 columns, ~6-8 rows.
  Current is too tall for the content it shows.

### Approach

Progressive enhancement:

1. **Default**: Unicode block mosaic (works everywhere)
2. **Detect Kitty/iTerm2**: Use image protocol for real pixel art
3. **Fallback**: Plain ASCII for ancient terminals

Use `chafa-wasm` for the Unicode mosaic generation — pass it an SVG/PNG of
the octopus, get back terminal-ready output. No runtime dependency on `chafa`
CLI.

## Message Rendering

- **Markdown rendering**: Assistant messages should render markdown (headers,
  code blocks, lists, bold/italic). Use `marked` + custom terminal renderer
  or `ink-markdown`.
- **Syntax highlighting**: Code blocks in assistant responses. Use `shiki` or
  `highlight.js` with terminal theme.
- **Word wrap**: Long lines should wrap at word boundaries, not mid-word.
  Ink's `<Text wrap="wrap">` helps but isn't perfect.
- **Timestamps**: Optional, subtle timestamps on messages.

## Input

- **Multi-line input**: Support Shift+Enter or similar for multi-line messages.
  Current `ink-text-input` is single-line only.
- **History**: Up/down arrow to recall previous messages.
- **Slash commands**: `/clear`, `/exit`, `/model`, `/help` — currently only
  `/clear` and `/exit`/`/quit` are implemented.

## Status Bar / Footer

- **Compact mode**: Single-line footer combining hints + status.
- **Cost tracking**: Show estimated cost ($) alongside token count.
- **Tick count**: Show current execution tick (for multi-tool-call runs).

## Tool Call Display

- **Collapsible**: Show tool name + duration when done, expandable to see
  input/output.
- **Progress**: Animated indicator while tool is running.
- **Grouping**: Multiple tool calls in one turn shown as a group.

## Quality of Life

- **Copy mode**: Vim-like mode to select and copy text from the chat.
- **Search**: Ctrl+F to search through message history.
- **Theme**: Configurable color scheme. Dark/light mode detection.
- **Resize handling**: Graceful re-layout on terminal resize.
