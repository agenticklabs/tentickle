import { useRef } from "react";
import { useState } from "react";
import { Ephemeral, useOnTickStart, useOnTickEnd } from "@agentick/core";

const FAILURE_THRESHOLD = 3;

/**
 * Circuit-breaker for blind retries.
 *
 * Tracks consecutive failures per tool within a single execution. After
 * FAILURE_THRESHOLD consecutive failures of the same tool, injects
 * ephemeral guidance to try a different approach. Resets on success,
 * and resets entirely at the start of each execution.
 *
 * Positioned "before-user" to preserve KV cache prefix.
 */
export function ErrorRecovery() {
  const failureCounts = useRef(new Map<string, number>());
  const [guidance, setGuidance] = useState<string | null>(null);

  // Reset failure counts at the start of each execution
  useOnTickStart((tickState) => {
    if (tickState.tick === 1) {
      failureCounts.current.clear();
      setGuidance(null);
    }
  });

  useOnTickEnd((result) => {
    const counts = failureCounts.current;
    const newGuidance: string[] = [];

    for (const tr of result.toolResults) {
      if (tr.success) {
        counts.delete(tr.name);
      } else {
        const count = (counts.get(tr.name) ?? 0) + 1;
        counts.set(tr.name, count);

        if (count >= FAILURE_THRESHOLD) {
          newGuidance.push(
            `${tr.name} has failed ${count} consecutive times. Stop retrying the same approach. Instead:\n` +
              `  - Re-read the error message carefully\n` +
              `  - Check if your assumptions about the code are wrong (re-read relevant files)\n` +
              `  - Try a fundamentally different approach\n` +
              `  - If stuck, use explore or web_fetch to research the issue`,
          );
        }
      }
    }

    setGuidance(newGuidance.length > 0 ? newGuidance.join("\n\n") : null);
  });

  if (!guidance) return null;

  return <Ephemeral position="before-user">{guidance}</Ephemeral>;
}
