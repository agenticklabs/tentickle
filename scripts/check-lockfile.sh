#!/bin/sh
# Checks if pnpm-lock.yaml is staged and contains agentick link: references.
# Used as a pre-commit guard to prevent committing a dirty lockfile.

if git diff --cached --name-only | grep -q "pnpm-lock.yaml"; then
  if grep -q "link:.*agentick" pnpm-lock.yaml; then
    echo "ERROR: pnpm-lock.yaml contains agentick links."
    echo "Run 'pnpm lock:clean' to regenerate from npm, then re-stage."
    exit 1
  fi
fi
