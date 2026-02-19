import type { AppOptions } from "@agentick/core";
import { createApp } from "@agentick/core";
import { MainAgent } from "./agent.js";
import type { MainAgentProps } from "./agent.js";

export { MainAgent };
export type { MainAgentProps };

export function createMainApp(options: AppOptions = {}) {
  return createApp<MainAgentProps>(MainAgent, options);
}
