# The TUI

Tentickle's terminal interface is built on [Ink](https://github.com/vadimdemedes/ink) and `@agentick/tui`. The coding agent has a custom TUI with task tracking, context injection, and tool confirmations.

## Features

- **Slash commands** — `/help`, `/attach`, `/add-dir`, `/clear`, `/exit`, `/config`
- **Tab completion** — file paths, `@mentions` for context injection, slash commands
- **Tool confirmations** — approve/reject file writes with diff previews
- **Attachments** — images and documents via `/attach`
- **Context strip** — `@mention` files to inject them as context
- **Task list** — live display of agent tasks with status indicators
- **Queue mode** — send messages while the agent is still working
- **Keyboard navigation** — arrow keys through attachment/context strips

## Interaction Model

Type a message and press Enter. The agent starts working — you'll see a spinner with tool call indicators. While the agent works, you can:

- **Send more messages** — they queue up and execute sequentially
- **Press Escape** — abort the current execution
- **Double Ctrl+C** — exit the TUI
- **Ctrl+L** — clear the screen

## Tool Confirmations

When the agent wants to write or edit a file, you get a confirmation prompt:

- **Y** — approve the change
- **N** — reject it
- **A** — approve all future changes in this execution
- **Type text** — reject with feedback (the agent sees your reason)

Writes to the agent's own data directory (`~/.tentickle/projects/...`) are auto-approved.

## Context Injection

Prefix a file path with `@` to inject it as context:

```
@src/auth.ts fix the login bug
```

The file path is added to a persistent context strip (visible above the input bar). The agent sees `[Context files: @src/auth.ts]` prepended to your message.

- Arrow keys navigate the context strip
- Backspace/Delete removes a file
- Down arrow or Escape exits strip focus
