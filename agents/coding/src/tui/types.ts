export type ChatMode = "idle" | "streaming" | "confirming_tool";
export type UIMode = "input" | "scroll";

export interface ToolCallEntry {
  id: string;
  name: string;
  status: "running" | "done";
  duration?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEntry[];
}
