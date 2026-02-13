import React from "react";
import { System, Timeline } from "@agentick/core";
import { Sandbox, Shell, ReadFile, WriteFile, EditFile } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import { Glob, Grep } from "@tentickle/tools";
import { SYSTEM_PROMPT } from "./system";

export type CodingAgentProps = {
  workspace?: string;
};

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  // useContinuation((result) => {
  //   console.log(result);
  //   const shouldStop = !result.text?.includes("<DONE>") &&
  //   result.tick < 30 &&
  //   ![
  //     StopReason.STOP,
  //     StopReason.NATURAL_COMPLETION,
  //     StopReason.TOOL_USE
  //   ].includes((result.stopReason as StopReason) || StopReason.STOP);
  //   console.log("shouldStop", shouldStop);
  //   return shouldStop ? result.stop() : result.continue();
  // });

  return (
    <Sandbox provider={localProvider()} workspace={workspace}>
      <System>{SYSTEM_PROMPT}</System>
      <Timeline />
      <ReadFile />
      <WriteFile />
      <EditFile />
      <Shell />
      <Glob />
      <Grep />
    </Sandbox>
  );
}
