import React from "react";
import { Model, System, Timeline, useComputed, useComState } from "@agentick/core";
import { Sandbox, Shell, ReadFile, WriteFile, EditFile } from "@agentick/sandbox";
import { localProvider } from "@agentick/sandbox-local";
import { Glob, Grep } from "@tentickle/tools";
import { openai } from "@agentick/openai";
import { google } from "@agentick/google";

export type CodingAgentProps = {
  workspace?: string;
};

// Parse Google credentials if provided
const GOOGLE_CREDENTIALS = process.env["GCP_CREDENTIALS"]
  ? JSON.parse(Buffer.from(process.env["GCP_CREDENTIALS"], "base64").toString("utf8"))
  : undefined;

/**
 * Dynamic model component that switches between OpenAI and Google based on config.
 */
export function DynamicModel() {
  const useGoogle = useComState<boolean>("useGoogle", process.env["USE_GOOGLE_MODEL"] === "true");
  const openaiModelName = useComState<string>(
    "openaiModel",
    process.env["OPENAI_MODEL"] || "gpt-4o-mini",
  );
  const googleModelName = useComState<string>(
    "googleModel",
    process.env["GOOGLE_MODEL"] || "gemini-2.0-flash",
  );

  const model = useComputed(() => {
    if (useGoogle()) {
      return google({
        model: googleModelName(),
        apiKey: process.env["GOOGLE_API_KEY"],
        vertexai: !!process.env["GCP_PROJECT_ID"],
        project: process.env["GCP_PROJECT_ID"],
        location: process.env["GCP_LOCATION"] || "us-central1",
        googleAuthOptions: GOOGLE_CREDENTIALS ? { credentials: GOOGLE_CREDENTIALS } : undefined,
      });
    } else {
      return openai({
        model: openaiModelName(),
        apiKey: process.env["OPENAI_API_KEY"],
        baseURL: process.env["OPENAI_BASE_URL"],
      });
    }
  }, [useGoogle, googleModelName, openaiModelName]);

  return <Model model={model()} />;
}

export function CodingAgent({ workspace = process.cwd() }: CodingAgentProps) {
  // useContinuation((result) => {
  //   if (result.tick >= 30) return false;
  // });

  return (
    <Sandbox provider={localProvider()} workspace={workspace}>
      <DynamicModel />
      <System>
        You are an expert software engineer. You work autonomously to complete coding tasks. ##
        Environment Your working directory is: {workspace}
        All file paths are relative to this directory. Use `glob` and `grep` to explore, `read_file`
        to read, `edit_file` for surgical edits, `write_file` for new files, and `shell` to run
        commands. ## How You Work 1. **Orient first.** Run `glob` with pattern `**/*` (or a narrower
        pattern) to see the project structure. Read key files (package.json, README, etc.) to
        understand the codebase. 2. **Read before editing.** Always read a file before modifying it.
        Use `grep` to find specific code patterns. 3. **Plan before you act.** For non-trivial
        changes, state your approach before editing. 4. **Make precise changes.** Use `edit_file`
        for surgical edits. Use `write_file` only for new files or complete rewrites. 5. **Verify
        your work.** After making changes, run tests or type checks if available via `shell`. 6.
        **Stay focused.** Complete the requested task. Don't refactor unrelated code or add
        unrequested features. ## Principles - Read the file before editing it. Always. - Prefer
        small, targeted edits over full file rewrites. - When you're unsure about the codebase
        structure, search first. - If a task is ambiguous, state your interpretation and proceed.
        Don't stall. - If you hit an error, diagnose it. Don't retry the same thing.`
      </System>
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
