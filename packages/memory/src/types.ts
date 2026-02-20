export interface RememberInput {
  content: string;
  namespace?: string;
  topic?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  sourceSessionId?: string;
}

export interface MemoryEntry {
  id: string;
  namespace: string;
  content: string;
  topic: string | null;
  metadata: Record<string, unknown> | null;
  importance: number;
  sourceSessionId: string | null;
  accessCount: number;
  lastAccessedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RecallQuery {
  query: string;
  namespace?: string;
  topic?: string;
  limit?: number;
}

export interface ScoredMemoryEntry extends MemoryEntry {
  score: number;
}

export interface RecallResult {
  entries: ScoredMemoryEntry[];
}
