import type { Session } from "@agentick/core";
import type { ToolConfirmationRequiredEvent, ChannelEvent } from "@agentick/shared";

export function pipeConfirmations(from: Session, to: Session): () => void {
  const childCallIds = new Set<string>();

  const onEvent = (event: ToolConfirmationRequiredEvent | { type: string }) => {
    if (event.type === "tool_confirmation_required" && "callId" in event) {
      childCallIds.add(event.callId);
      to.pushEvent({ ...event });
    }
  };
  from.on("event", onEvent);

  const unsubChannel = to.channel("tool_confirmation").subscribe((event: ChannelEvent) => {
    if (event.type === "response" && event.id && childCallIds.has(event.id)) {
      from.channel("tool_confirmation").publish(event);
      childCallIds.delete(event.id);
    }
  });

  return () => {
    from.removeListener("event", onEvent);
    unsubChannel();
    childCallIds.clear();
  };
}

const TOOL_EVENT_TYPES = new Set(["tool_call_start", "tool_call", "tool_result"]);

/** Forward worker tool events to owner session so SessionTree can show per-tool activity. */
export function pipeToolEvents(from: Session, to: Session, spawnId: string): () => void {
  const onEvent = (event: { type: string; spawnPath?: string[] }) => {
    if (TOOL_EVENT_TYPES.has(event.type)) {
      to.pushEvent({ ...event, spawnPath: [spawnId, ...(event.spawnPath ?? [])] });
    }
  };
  from.on("event", onEvent);
  return () => from.removeListener("event", onEvent);
}
