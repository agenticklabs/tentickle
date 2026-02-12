import type { EngineModel } from "@agentick/core";
import { createApp } from "@agentick/core";
import { CodingAgent } from "./agent.js";
import type { CodingAgentProps } from "./agent.js";

export { CodingAgent };
export type { CodingAgentProps };

export function createCodingApp(options: { model: EngineModel; devTools?: boolean }) {
  return createApp<CodingAgentProps>(CodingAgent, {
    model: options.model,
    devTools: options.devTools,
  });
}
