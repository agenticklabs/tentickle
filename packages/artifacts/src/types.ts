export interface ArtifactInput {
  name: string;
  type: string;
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactEntry {
  id: string;
  name: string;
  type: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}
