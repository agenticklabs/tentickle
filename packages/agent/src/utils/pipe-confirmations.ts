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
