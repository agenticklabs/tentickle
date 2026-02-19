import { useState } from "react";
import { Grounding, useOnMount } from "@agentick/core";
import { readFile } from "node:fs/promises";
import { getIdentityPath } from "./paths.js";
import { fileAge } from "./utils.js";

/**
 * Loads ~/.tentickle/IDENTITY.md into context.
 *
 * This is the agent's self-authored soul document — who it is, who its
 * human is, what it values. Renders before system prompt so identity
 * primes everything downstream.
 */
export function Identity() {
  const [content, setContent] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);

  useOnMount(async () => {
    const path = getIdentityPath();
    try {
      const text = await readFile(path, "utf-8");
      if (text.trim()) {
        setContent(text);
        setAge(fileAge(path));
      }
    } catch {}
  });

  if (!content) return null;
  const title = age ? `Identity (updated ${age})` : "Identity";
  return <Grounding title={title}>{content}</Grounding>;
}
