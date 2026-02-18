#!/usr/bin/env node

// TODO: This is a stub. The real CLI needs:
// - Argument parsing (--model, --workspace, --verbose, etc.)
// - `tentickle init` — scaffold .env, CLAUDE.md, etc.
// - `tentickle doctor` — verify env, API keys, sandbox support
// - `tentickle` (no args) — launch TUI in cwd
//
// For now, the dev entry point is:
//   pnpm --filter @tentickle/coding start

console.error(
  "tentickle is not yet published. Run from source:\n\n" +
    "  cd tentickle\n" +
    "  pnpm --filter @tentickle/coding start\n",
);
process.exit(1);
