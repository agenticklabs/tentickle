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
  /** Time decay lambda. Higher = faster decay. Set to 0 to disable. Default: 0.005 */
  decay?: number;
}

export interface ScoredMemoryEntry extends MemoryEntry {
  score: number;
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface RecallHints {
  /** Topics present in the returned entries. */
  matchedTopics: string[];
  /** Topics from vec overflow (semantically close but didn't make the cut). */
  relatedTopics: string[];
  /** All topics in namespace, max 50, desc by count. */
  topicMap: TopicCount[];
}

export interface RecallResult {
  entries: ScoredMemoryEntry[];
  hints: RecallHints;
}
