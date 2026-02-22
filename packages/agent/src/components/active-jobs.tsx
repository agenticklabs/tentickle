import React from "react";
import { Section } from "@agentick/core";
import type { TentickleSessionStore, SessionRow } from "@tentickle/storage";

function formatDelegation(row: SessionRow, store: TentickleSessionStore): string {
  const elapsed = Math.round((Date.now() - row.created_at) / 1000);
  const time = elapsed < 60 ? `${elapsed}s` : `${Math.round(elapsed / 60)}m`;
  const stats = store.getSessionStats(row.id);
  return `[${row.id.slice(0, 8)}] ${row.title ?? "(untitled)"} — ${row.status} (${row.session_type}, tick ${stats.tickCount}, ${stats.toolCallCount} tools, ${time})`;
}

export function ActiveJobs({
  store,
  ownerSessionId,
}: {
  store: TentickleSessionStore;
  ownerSessionId: string;
}) {
  const active = store.getActiveDelegations(ownerSessionId);
  if (active.length === 0) return null;

  return (
    <Section id="active-jobs" title="Active Delegations">
      {active.map((row) => formatDelegation(row, store)).join("\n")}
    </Section>
  );
}
