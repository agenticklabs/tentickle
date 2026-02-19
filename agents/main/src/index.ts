import type { AppOptions } from "@agentick/core";
import { createTentickleApp } from "@tentickle/agent";
import { MainAgent } from "./agent.js";
import type { MainAgentProps } from "./agent.js";

export { MainAgent };
export type { MainAgentProps };

export function createMainApp(options: AppOptions = {}) {
  return createTentickleApp<MainAgentProps>(MainAgent, options);
}
