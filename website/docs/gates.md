# Verification Gates

Gates are named checkpoints that block the model from completing until cleared. They're the framework's answer to "the model should verify its work but we can't hard-code what verification means."

## How It Works

A gate is a [knob](https://agenticklabs.github.io/agentick/docs/knobs) with three states and auto-activation logic:

| State      | Model Sees It     | Blocks Exit           | Instructions Shown |
| ---------- | ----------------- | --------------------- | ------------------ |
| `inactive` | No                | No                    | No                 |
| `active`   | Yes               | Yes                   | Yes (ephemeral)    |
| `deferred` | Yes (as deferred) | Yes (un-defers first) | No                 |

## The Flow

```
Model edits files (tick N)
  └─ tick end: activateWhen fires → gate goes active
  └─ model would stop → gate forces continuation

Model gets another turn (tick N+1)
  └─ sees: "VERIFICATION PENDING: verify your changes..."
  └─ runs typecheck, tests, lint (whatever the project needs)
  └─ calls set_knob to clear the gate

Tick N+1 ends
  └─ gate is clear → execution completes normally
```

## Usage

```tsx
import { gate, useGate } from "@agentick/core";

const verificationGate = gate({
  description: "Verify your changes before completing",
  instructions: `VERIFICATION PENDING: You've modified files.
    Run appropriate checks. Clear the gate when satisfied.`,
  activateWhen: (result) =>
    result.toolCalls.some((tc) => ["write_file", "edit_file"].includes(tc.name)),
});

function CodingAgent({ workspace }) {
  const verification = useGate("verification", verificationGate);

  return (
    <TentickleAgent workspace={workspace}>
      {/* ... */}
      {verification.element}
    </TentickleAgent>
  );
}
```

`gate()` creates a descriptor. `useGate()` returns state and an auto-rendered `<Ephemeral>` element. The agent places `{verification.element}` in its tree — it renders instructions when active, `null` otherwise.

## Defer

The model can defer a gate (`set_knob verification deferred`) to acknowledge it but continue other work. Deferred gates:

- Still block at exit (un-defer to `active` first)
- Don't show the instruction prompt while deferred
- Force the model to face the gate before completing

## Key Properties

- **One-way ratchet**: `activateWhen` only fires from `inactive`. Once engaged, the model controls it.
- **Exit-only**: Gates don't interfere during multi-step work. They only catch the exit attempt.
- **Model-controlled**: The model clears gates via `set_knob`. The framework nudges; it doesn't jail.
- **Re-activatable**: If the model clears a gate and then edits more files in the same tick, the gate re-activates.

## GateState

```typescript
interface GateState {
  active: boolean; // true when gate is active
  deferred: boolean; // true when gate is deferred
  engaged: boolean; // active || deferred
  clear: () => void; // set to inactive
  defer: () => void; // set to deferred
  element: JSX.Element | null; // Ephemeral when active
}
```
