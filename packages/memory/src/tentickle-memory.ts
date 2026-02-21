import { randomUUID } from "node:crypto";
import type { EmbedResult } from "@agentick/shared";
import type {
  RememberInput,
  MemoryEntry,
  RecallQuery,
  RecallResult,
  RecallHints,
  ScoredMemoryEntry,
  TopicCount,
} from "./types.js";

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>;

interface MemoryRow {
  id: string;
  namespace: string;
  content: string;
  topic: string | null;
  importance: number;
  metadata: string | null;
  source_session_id: string | null;
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface FtsRow extends MemoryRow {
  rank: number;
}

interface VecRow extends MemoryRow {
  distance: number;
}

/** Cast node:sqlite's loose row array to a concrete type. */
function rows<T>(result: unknown): T[] {
  return result as T[];
}

/** Cast node:sqlite's loose single-row result to a concrete type. */
function row<T>(result: unknown): T | undefined {
  return result as T | undefined;
}

function rowToEntry(r: MemoryRow): MemoryEntry {
  return {
    id: r.id,
    namespace: r.namespace,
    content: r.content,
    topic: r.topic,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    importance: r.importance,
    sourceSessionId: r.source_session_id,
    accessCount: r.access_count,
    lastAccessedAt: r.last_accessed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Normalize FTS5 rank (negative BM25 score) to 0–1 where 1 is best match.
 * FTS5 rank values are negative — lower (more negative) means better match.
 * We negate and apply a sigmoid-like transform to normalize.
 */
function normalizeScore(rank: number): number {
  const raw = -rank;
  return raw / (raw + 1);
}

/** RRF constant — standard value from the original paper. */
const RRF_K = 60;

/** Default time decay lambda: 30d→86%, 90d→64%, 365d→16%. */
const DEFAULT_DECAY_LAMBDA = 0.005;

/** Default cosine similarity threshold for dedup (0.90 = very similar). */
const DEFAULT_DEDUP_THRESHOLD = 0.9;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Weight for access count boost: score * (1 + log1p(accessCount) * weight). */
const ACCESS_BOOST_WEIGHT = 0.1;

export type EmbedFn = (texts: string[]) => Promise<EmbedResult>;

export interface VecOptions {
  embed: EmbedFn;
  dimensions: number;
  /** Cosine similarity threshold for dedup on remember. Set to 0 to disable. Default: 0.90 */
  dedupThreshold?: number;
}

export class TentickleMemory {
  private db: DatabaseSync;
  private destroyed = false;

  // Vec state
  private vecEnabled = false;
  private vecDimensions = 0;
  private embedFn: EmbedFn | null = null;
  private dedupThreshold = DEFAULT_DEDUP_THRESHOLD;
  private pendingEmbeds = new Map<string, Promise<void>>();
  private backfillPromise: Promise<void> | null = null;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static create(db: DatabaseSync): TentickleMemory {
    return new TentickleMemory(db);
  }

  // ==========================================================================
  // Vec initialization
  // ==========================================================================

  /**
   * Enable vector search by loading sqlite-vec and providing an embed function.
   * Returns true on success, false if sqlite-vec can't load (e.g. no allowExtension).
   * Kicks off background backfill of any existing memories without vectors.
   */
  initVec(options: VecOptions): boolean {
    try {
      // Dynamic import to avoid hard dep when vec isn't needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require("sqlite-vec");
      sqliteVec.load(this.db);

      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        memory_id TEXT PRIMARY KEY,
        namespace TEXT PARTITION KEY,
        embedding float[${options.dimensions}] distance_metric=cosine
      )`);

      this.embedFn = options.embed;
      this.vecDimensions = options.dimensions;
      this.dedupThreshold = options.dedupThreshold ?? DEFAULT_DEDUP_THRESHOLD;
      this.vecEnabled = true;
      this.startBackfill();
      return true;
    } catch {
      return false;
    }
  }

  /** Whether vector search is active. */
  get hasVec(): boolean {
    return this.vecEnabled;
  }

  // ==========================================================================
  // Core API
  // ==========================================================================

  remember(input: RememberInput): MemoryEntry {
    this.assertAlive();

    const id = randomUUID();
    const now = Date.now();
    const namespace = input.namespace ?? "default";
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const importance = input.importance ?? 0.5;

    this.db
      .prepare(
        `INSERT INTO memories (id, namespace, content, topic, importance, metadata, source_session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        namespace,
        input.content,
        input.topic ?? null,
        importance,
        metadata,
        input.sourceSessionId ?? null,
        now,
        now,
      );

    // Fire-and-forget embedding — remember stays sync
    if (this.vecEnabled && this.embedFn) {
      const promise = this.embedAndStore(id, input.content, namespace).catch(() => {});
      this.pendingEmbeds.set(id, promise);
      promise.finally(() => this.pendingEmbeds.delete(id));
    }

    return {
      id,
      namespace,
      content: input.content,
      topic: input.topic ?? null,
      metadata: input.metadata ?? null,
      importance,
      sourceSessionId: input.sourceSessionId ?? null,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async recall(query: RecallQuery): Promise<RecallResult> {
    this.assertAlive();

    const limit = query.limit ?? 10;
    const trimmed = query.query.trim();
    if (!trimmed) {
      const topicMap = this.getTopicMap(query.namespace);
      const hints: RecallHints = { matchedTopics: [], relatedTopics: [], topicMap };
      return { entries: [], hints };
    }

    // Always run FTS
    const ftsResults = this.ftsSearch(trimmed, query.namespace, query.topic, limit);

    // Vec search if available
    let vecResults: ScoredMemoryEntry[] = [];
    if (this.vecEnabled && this.embedFn) {
      try {
        const result = await this.embedFn([trimmed]);
        vecResults = this.vecSearch(result.embeddings[0], query.namespace, query.topic, limit * 3);
      } catch {
        // Non-fatal — degrade to FTS-only
      }
    }

    // Fuse or return FTS-only
    let entries = vecResults.length > 0 ? this.rrfFuse(ftsResults, vecResults, limit) : ftsResults;

    // Post-scoring adjustments: time decay + access boost
    const decay = query.decay ?? DEFAULT_DECAY_LAMBDA;
    if (entries.length > 0) {
      entries = applyPostScoring(entries, decay, limit);
    }

    // Collect hints
    const finalIds = new Set(entries.map((e) => e.id));
    const matchedTopics = [
      ...new Set(entries.map((e) => e.topic).filter((t): t is string => t !== null)),
    ];
    const matchedTopicSet = new Set(matchedTopics);
    const relatedTopics =
      query.topic != null
        ? []
        : [
            ...new Set(
              vecResults
                .filter((e) => !finalIds.has(e.id) && e.topic !== null)
                .map((e) => e.topic as string),
            ),
          ].filter((t) => !matchedTopicSet.has(t));
    const topicMap = this.getTopicMap(query.namespace);
    const hints: RecallHints = { matchedTopics, relatedTopics, topicMap };

    // Update access tracking for matched entries
    if (entries.length > 0) {
      const now = Date.now();
      const ids = entries.map((e) => e.id);
      const placeholders = ids.map(() => "?").join(",");
      this.db
        .prepare(
          `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (${placeholders})`,
        )
        .run(now, ...ids);

      // Reflect updated access in returned entries
      for (const entry of entries) {
        entry.accessCount += 1;
        entry.lastAccessedAt = now;
      }
    }

    return { entries, hints };
  }

  get(id: string): MemoryEntry | null {
    this.assertAlive();
    const r = row<MemoryRow>(this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id));
    return r ? rowToEntry(r) : null;
  }

  delete(id: string): boolean {
    this.assertAlive();
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    if (result.changes > 0 && this.vecEnabled) {
      try {
        this.db.prepare(`DELETE FROM memory_vec WHERE memory_id = ?`).run(id);
      } catch {
        // Vec row may not exist yet (embedding in-flight)
      }
    }
    return result.changes > 0;
  }

  list(namespace?: string): MemoryEntry[] {
    this.assertAlive();
    if (namespace != null) {
      return rows<MemoryRow>(
        this.db
          .prepare(
            `SELECT * FROM memories WHERE namespace = ? ORDER BY created_at DESC, rowid DESC`,
          )
          .all(namespace),
      ).map(rowToEntry);
    }
    return rows<MemoryRow>(
      this.db.prepare(`SELECT * FROM memories ORDER BY created_at DESC, rowid DESC`).all(),
    ).map(rowToEntry);
  }

  /** Await all pending embed operations and backfill. Used in tests. */
  async flush(): Promise<void> {
    if (this.backfillPromise) {
      await this.backfillPromise;
    }
    await Promise.all(this.pendingEmbeds.values());
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingEmbeds.clear();
    this.backfillPromise = null;
  }

  // ==========================================================================
  // Private — Topic map
  // ==========================================================================

  private getTopicMap(namespace?: string): TopicCount[] {
    const params: string[] = [];
    let sql = `SELECT topic, COUNT(*) as count FROM memories WHERE topic IS NOT NULL`;
    if (namespace != null) {
      sql += ` AND namespace = ?`;
      params.push(namespace);
    }
    sql += ` GROUP BY topic ORDER BY count DESC LIMIT 50`;
    return rows<{ topic: string; count: number }>(this.db.prepare(sql).all(...params)).map((r) => ({
      topic: r.topic,
      count: r.count,
    }));
  }

  // ==========================================================================
  // Private — FTS search
  // ==========================================================================

  private ftsSearch(
    query: string,
    namespace?: string,
    topic?: string,
    limit = 10,
  ): ScoredMemoryEntry[] {
    const safeQuery = escapeForFts5(query);

    let sql = `SELECT m.*, fts.rank
      FROM memories m
      JOIN memories_fts fts ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?`;

    const params: (string | number)[] = [safeQuery];

    if (namespace != null) {
      sql += ` AND m.namespace = ?`;
      params.push(namespace);
    }
    if (topic != null) {
      sql += ` AND m.topic = ?`;
      params.push(topic);
    }

    sql += ` ORDER BY fts.rank LIMIT ?`;
    params.push(limit);

    const matched = rows<FtsRow>(this.db.prepare(sql).all(...params));

    return matched.map((r) => ({
      ...rowToEntry(r),
      score: normalizeScore(r.rank),
    }));
  }

  // ==========================================================================
  // Private — Vec search
  // ==========================================================================

  private vecSearch(
    queryVec: number[],
    namespace?: string,
    topic?: string,
    limit = 30,
  ): ScoredMemoryEntry[] {
    if (!this.vecEnabled) return [];

    const blob = new Float32Array(queryVec);

    let sql: string;
    const params: (string | number | Float32Array)[] = [];

    if (namespace != null) {
      sql = `SELECT m.*, knn.distance
        FROM (
          SELECT memory_id, distance
          FROM memory_vec
          WHERE embedding MATCH ?
            AND k = ?
            AND namespace = ?
        ) knn
        JOIN memories m ON m.id = knn.memory_id`;
      params.push(blob, limit, namespace);
    } else {
      sql = `SELECT m.*, knn.distance
        FROM (
          SELECT memory_id, distance
          FROM memory_vec
          WHERE embedding MATCH ?
            AND k = ?
        ) knn
        JOIN memories m ON m.id = knn.memory_id`;
      params.push(blob, limit);
    }

    if (topic != null) {
      sql += ` WHERE m.topic = ?`;
      params.push(topic);
    }

    sql += ` ORDER BY knn.distance ASC`;

    try {
      const matched = rows<VecRow>(this.db.prepare(sql).all(...params));
      return matched.map((r) => ({
        ...rowToEntry(r),
        score: 1 - r.distance, // cosine distance → similarity
      }));
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Private — RRF fusion
  // ==========================================================================

  /**
   * Reciprocal Rank Fusion: merge FTS and vec results.
   * score(d) = Σ 1/(k + rank_i(d)) for each source containing d
   */
  private rrfFuse(
    ftsResults: ScoredMemoryEntry[],
    vecResults: ScoredMemoryEntry[],
    limit: number,
  ): ScoredMemoryEntry[] {
    const scoreMap = new Map<string, { entry: ScoredMemoryEntry; rrfScore: number }>();

    for (let i = 0; i < ftsResults.length; i++) {
      const entry = ftsResults[i];
      const existing = scoreMap.get(entry.id);
      const rrfDelta = 1 / (RRF_K + i + 1);
      if (existing) {
        existing.rrfScore += rrfDelta;
      } else {
        scoreMap.set(entry.id, { entry, rrfScore: rrfDelta });
      }
    }

    for (let i = 0; i < vecResults.length; i++) {
      const entry = vecResults[i];
      const existing = scoreMap.get(entry.id);
      const rrfDelta = 1 / (RRF_K + i + 1);
      if (existing) {
        existing.rrfScore += rrfDelta;
      } else {
        scoreMap.set(entry.id, { entry, rrfScore: rrfDelta });
      }
    }

    // Sort by RRF score descending, then normalize to 0–1
    const sorted = [...scoreMap.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, limit);

    if (sorted.length === 0) return [];

    const maxScore = sorted[0].rrfScore;
    return sorted.map(({ entry, rrfScore }) => ({
      ...entry,
      score: maxScore > 0 ? rrfScore / maxScore : 0,
    }));
  }

  // ==========================================================================
  // Private — Embedding
  // ==========================================================================

  private async embedAndStore(id: string, content: string, namespace: string): Promise<void> {
    if (!this.embedFn || this.destroyed) return;
    const result = await this.embedFn([content]);
    if (this.destroyed) return;
    const blob = new Float32Array(result.embeddings[0]);

    // Dedup: check for semantically similar existing memory before inserting
    if (this.dedupThreshold > 0) {
      const existing = this.findSimilar(blob, namespace, id);
      if (existing) {
        // Merge into existing: update content + timestamp, delete the new row
        const now = Date.now();
        try {
          this.db
            .prepare(`UPDATE memories SET content = ?, updated_at = ? WHERE id = ?`)
            .run(content, now, existing);
          this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
          // Update the existing entry's vector with the new (fresher) embedding
          this.db
            .prepare(
              `INSERT OR REPLACE INTO memory_vec (memory_id, namespace, embedding) VALUES (?, ?, ?)`,
            )
            .run(existing, namespace, blob);
        } catch {
          // DB might be closed during shutdown
        }
        return;
      }
    }

    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO memory_vec (memory_id, namespace, embedding) VALUES (?, ?, ?)`,
        )
        .run(id, namespace, blob);
    } catch {
      // DB might be closed during shutdown
    }
  }

  /**
   * Find an existing memory in the same namespace that's semantically similar.
   * Returns the existing memory's ID, or null if nothing is similar enough.
   */
  private findSimilar(queryVec: Float32Array, namespace: string, excludeId: string): string | null {
    try {
      // Fetch top-2 so we can skip self if it's already inserted
      const matched = rows<{ memory_id: string; distance: number }>(
        this.db
          .prepare(
            `SELECT memory_id, distance FROM memory_vec
             WHERE embedding MATCH ? AND k = 2 AND namespace = ?`,
          )
          .all(queryVec, namespace),
      );
      const maxDistance = 1 - this.dedupThreshold;
      for (const r of matched) {
        if (r.memory_id !== excludeId && r.distance < maxDistance) {
          return r.memory_id;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private startBackfill(): void {
    if (!this.vecEnabled || !this.embedFn) return;

    this.backfillPromise = (async () => {
      const BATCH_SIZE = 10;
      while (!this.destroyed) {
        const missing = rows<{ id: string; namespace: string; content: string }>(
          this.db
            .prepare(
              `SELECT m.id, m.namespace, m.content
               FROM memories m
               LEFT JOIN memory_vec v ON v.memory_id = m.id
               WHERE v.memory_id IS NULL
               LIMIT ?`,
            )
            .all(BATCH_SIZE),
        );

        if (missing.length === 0) break;

        for (const entry of missing) {
          if (this.destroyed) return;
          try {
            await this.embedAndStore(entry.id, entry.content, entry.namespace);
          } catch {
            // Skip failures, continue with next
          }
        }
      }
    })();
  }

  // ==========================================================================
  // Private — Lifecycle
  // ==========================================================================

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("TentickleMemory has been destroyed");
    }
  }
}

/**
 * Apply exponential time decay to scored entries.
 * Age is measured from lastAccessedAt (if ever accessed) or createdAt.
 * Recalled memories are "refreshed" — accessing keeps them alive.
 */
function applyPostScoring(
  entries: ScoredMemoryEntry[],
  lambda: number,
  limit: number,
): ScoredMemoryEntry[] {
  const now = Date.now();
  const adjusted = entries.map((entry) => {
    let factor = 1;
    // Time decay (skip when lambda=0)
    if (lambda > 0) {
      const referenceTime = entry.lastAccessedAt ?? entry.createdAt;
      const ageDays = (now - referenceTime) / MS_PER_DAY;
      factor = Math.exp(-lambda * ageDays);
    }
    // Access count boost (always applied)
    const accessBoost = 1 + Math.log1p(entry.accessCount) * ACCESS_BOOST_WEIGHT;
    return { ...entry, score: entry.score * factor * accessBoost };
  });
  adjusted.sort((a, b) => b.score - a.score);
  const top = adjusted.slice(0, limit);
  if (top.length === 0) return top;
  const maxScore = top[0].score;
  if (maxScore > 0) {
    for (const entry of top) {
      entry.score = entry.score / maxScore;
    }
  }
  return top;
}

/**
 * Escape a user query string for FTS5 MATCH.
 * Wraps each whitespace-delimited token in double quotes to prevent
 * FTS5 syntax errors from special characters (*, -, ^, etc.).
 * Tokens are joined with OR — any matching token contributes to score.
 * BM25 ranks results by how many tokens match and their frequency.
 */
function escapeForFts5(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}
