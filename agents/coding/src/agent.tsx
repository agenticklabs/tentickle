import React from "react";
import { System, Timeline, useContinuation } from "@agentick/core";
import { Sandbox, Shell, ReadFile, WriteFile, EditFile } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import { Glob, Grep } from "@tentickle/tools";
import { SYSTEM_PROMPT } from "./system";
import { StopReason } from "@agentick/core/model";

export type CodingAgentProps = {
  workspace?: string;
};

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  useContinuation((result) => {
    console.log(result);
    return (
      !result.text?.includes("<DONE>") &&
      result.tick < 30 &&
      result.stopReason !== StopReason.STOP &&
      result.stopReason !== StopReason.NATURAL_COMPLETION &&
      result.stopReason !== StopReason.TOOL_USE
    );
  });

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
