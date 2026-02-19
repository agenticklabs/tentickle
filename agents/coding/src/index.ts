import type { AppOptions } from "@agentick/core";
import { createTentickleApp } from "@tentickle/agent";
import { CodingAgent } from "./agent.js";
import type { CodingAgentProps } from "./agent.js";

export { CodingAgent };
export type { CodingAgentProps };

export function createCodingApp(options: AppOptions = {}) {
  return createTentickleApp<CodingAgentProps>(CodingAgent, options);
}
