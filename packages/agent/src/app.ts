import type { App, AppOptions, ComponentFunction } from "@agentick/core";
import type { StreamEvent, EntryCommittedEvent } from "@agentick/shared";
import { createApp } from "@agentick/core";
import { getDbPath } from "./paths.js";
import { openDatabase, TentickleSessionStore } from "./storage/index.js";

export interface TentickleAppResult<P> {
  app: App<P>;
  store: TentickleSessionStore;
}

function wireStorePersistence(store: TentickleSessionStore, event: StreamEvent): void {
  switch (event.type) {
    case "execution_start": {
      const sessionId = event.sessionId ?? event.executionId;
      store.createExecution(event.executionId, sessionId, "send");
      break;
    }
    case "tick_start": {
      if (event.executionId) {
        store.recordTickStart(event.executionId, event.tick);
      }
      break;
    }
    case "entry_committed": {
      const e = event as EntryCommittedEvent;
      if (event.sessionId) {
        store.commitEntry(
          event.sessionId,
          e.entry as any,
          e.executionId,
          event.tick,
          e.timelineIndex,
        );
      }
      break;
    }
    case "tick_end": {
      if (event.executionId) {
        store.recordTickEnd(
          event.executionId,
          event.tick,
          event.model,
          event.usage,
          typeof event.stopReason === "string" ? event.stopReason : undefined,
        );
      }
      break;
    }
    case "execution_end": {
      const status = event.error ? "failed" : event.aborted ? "aborted" : "completed";
      store.completeExecution(event.executionId, status, event.tick, event.error?.message);
      break;
    }
  }
}

export async function createTentickleApp<P extends Record<string, unknown>>(
  Agent: ComponentFunction<P>,
  options: AppOptions = {},
): Promise<TentickleAppResult<P>> {
  const db = await openDatabase(getDbPath());
  const store = new TentickleSessionStore(db);

  const app = createApp<P>(Agent, {
    ...options,
    sessions: { ...options.sessions, store },
    onEvent: (event) => {
      try {
        wireStorePersistence(store, event);
      } catch {
        // don't crash session on persistence failures
      }
      options.onEvent?.(event);
    },
  });

  return { app, store };
}
