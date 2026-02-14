# TUI Wishlist

Tracked issues, ideas, and aspirations for the tentickle terminal UI.

## ~~Critical: Alternate Screen Mode~~ (Dropped)

Dropped — the inline mode with console.log scrollback is the preferred approach.

## ~~Ink `<Static>` — Broken or Misunderstood~~ (Resolved)

No longer relevant — CodingTUI uses `console.log` + `renderMessage` for scrollback
output, bypassing `<Static>` entirely. The framework's `MessageList` still uses it
for the default `Chat` component.

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
- **History**: Up/down arrow to recall previous messages. ✅ Done — built into `useLineEditor`.
- **Slash commands**: `/clear`, `/exit`, `/model`, `/help` — currently only
  `/clear` and `/exit`/`/quit` are implemented.

## Status Bar / Footer

- **Compact mode**: Single-line footer combining hints + status. ✅ Done — `@agentick/tui` StatusBar system with composable widgets.
- **Cost tracking**: Show estimated cost ($) alongside token count.
- **Tick count**: Show current execution tick (for multi-tool-call runs). ✅ Done — `<TickCount>` widget in `@agentick/tui`.

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

## File Attachments and Selection

- **Typeahead file selection**: List matched file paths below the input, possibly below the footer. Similar to the proposed slash commands UI. Type to filter and navigate with up and down to select an option.
- **Multi-modal attachment support**.

## Input Enhancements and Bug Fixes

- **Trigger character utility**: Create a utility to abstract the concept of trigger characters that initiate actions (e.g., `@` for file picker, `/` for slash commands).
- **Multi-line input (Shift+Enter)**: Support adding newlines in the input field using the Shift + Enter key combination.
- **Bug fix: Edit approval character**: Fix the bug where the approved edit character ends up in the input field after approving an edit. ✅ Fixed — added `isDisabled={chatMode !== "idle"}` to InputBar.
- **Attachments**: You can paste images into the input field to attach them to the message.
