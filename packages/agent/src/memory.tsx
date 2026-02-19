import { useState, useEffect } from "react";
import { Grounding, Section, useOnMount, useOnTickEnd } from "@agentick/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getMemoryPath, getClaudeMemoryDir } from "./paths.js";
import { fileAge } from "./utils.js";

/**
 * Project memory — re-reads after each tick so the agent always sees
 * its latest notes.
 */
export function Memory({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useOnTickEnd(() => setVersion((v) => v + 1));

  useEffect(() => {
    const path = getMemoryPath(workspace);
    readFile(path, "utf-8")
      .then((text) => {
        setContent(text);
        setAge(fileAge(path));
      })
      .catch(() => {
        setContent(null);
        setAge(null);
      });
  }, [workspace, version]);

  if (!content) return null;
  const title = age ? `Project Memory (updated ${age})` : "Project Memory";
  return (
    <Section id="memory" title={title}>
      {content}
    </Section>
  );
}

/**
 * Reads Claude Code's MEMORY.md if present. Read-only — we never write
 * to Claude Code's memory, only learn from it.
 */
export function ClaudeMemory({ workspace }: { workspace: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);

  useOnMount(async () => {
    const dir = getClaudeMemoryDir(workspace);
    const memoryPath = join(dir, "MEMORY.md");
    try {
      const text = await readFile(memoryPath, "utf-8");
      if (text.trim()) {
        setContent(text);
        setAge(fileAge(memoryPath));
      }
    } catch {}
  });

  if (!content) return null;
  const title = age
    ? `Claude Code Memory (read-only, updated ${age})`
    : "Claude Code Memory (read-only)";
  return <Grounding title={title}>{content}</Grounding>;
}
