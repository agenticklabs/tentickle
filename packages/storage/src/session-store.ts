import { randomUUID } from "node:crypto";
import type { SessionSnapshot, SessionStore } from "@agentick/core";
import type { COMTimelineEntry } from "@agentick/core";
import type { ContentBlock } from "@agentick/shared";
import { extractText } from "@agentick/shared";
import type { ContentBlockRow, MessageRow, SessionRow, SessionSnapshotRow } from "./types.js";

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>;

/** Helper to cast node:sqlite's loose row types to concrete row types. */
function rows<T>(result: unknown): T[] {
  return result as T[];
}

function row<T>(result: unknown): T | undefined {
  return result as T | undefined;
}

const TEXT_PREVIEW_MAX = 500;

function truncatePreview(text: string): string {
  if (text.length <= TEXT_PREVIEW_MAX) return text;
  return text.slice(0, TEXT_PREVIEW_MAX);
}

/** Extract plain text block type for querying without parsing content_json. */
function extractBlockType(block: ContentBlock): string {
  return block.type;
}

/** Extract searchable text content from a block (null for media-only blocks). */
function extractTextContent(block: ContentBlock): string | null {
  if ("text" in block && typeof block.text === "string") return block.text;
  if ("data" in block && typeof block.data === "string") return block.data;
  return null;
}

/**
 * Strip transient SemanticContentBlock fields before persisting.
 * Returns a plain ContentBlock that roundtrips cleanly through JSON.
 */
function stripTransientFields(block: ContentBlock): ContentBlock {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { semanticNode, semantic, formatter, ...rest } = block as ContentBlock & {
    semanticNode?: unknown;
    semantic?: unknown;
    formatter?: unknown;
  };
  return rest as ContentBlock;
}

export class TentickleSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // ==========================================================================
  // Incremental persistence methods (called from onEvent)
  // ==========================================================================

  /** execution_start → INSERT execution record */
  createExecution(executionId: string, sessionId: string, triggerType: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO executions (id, session_id, trigger_type, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      )
      .run(executionId, sessionId, triggerType, Date.now());
  }

  /** tick_start → INSERT tick record */
  recordTickStart(executionId: string, tickNumber: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ticks (execution_id, tick_number, started_at)
         VALUES (?, ?, ?)`,
      )
      .run(executionId, tickNumber, Date.now());
  }

  /** entry_committed → INSERT message + content_blocks in one transaction */
  commitEntry(
    sessionId: string,
    entry: COMTimelineEntry,
    executionId: string,
    tick: number,
    timelineIndex: number,
  ): void {
    const messageId = entry.id ?? randomUUID();
    const now = Date.now();

    this.db.exec("BEGIN");
    try {
      const textPreview = truncatePreview(extractText(entry.message.content as ContentBlock[]));

      this.db
        .prepare(
          `INSERT OR IGNORE INTO messages
           (id, session_id, execution_id, role, tick, sequence_in_tick, text_preview, visibility, tags, tokens, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          sessionId,
          executionId,
          entry.message.role,
          tick,
          timelineIndex,
          textPreview || null,
          entry.visibility ?? null,
          entry.tags ? JSON.stringify(entry.tags) : null,
          entry.tokens ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          now,
        );

      const content = entry.message.content as ContentBlock[];
      const insertBlock = this.db.prepare(
        `INSERT OR IGNORE INTO content_blocks (id, message_id, position, block_type, text_content, content_json, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let pos = 0; pos < content.length; pos++) {
        const block = content[pos];
        const stripped = stripTransientFields(block);
        insertBlock.run(
          randomUUID(),
          messageId,
          pos,
          extractBlockType(block),
          extractTextContent(block),
          JSON.stringify(stripped),
          null,
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** tick_end → UPDATE tick record with model/usage/stop_reason */
  recordTickEnd(
    executionId: string,
    tickNumber: number,
    model?: string,
    usage?: unknown,
    stopReason?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE ticks SET model = ?, usage = ?, stop_reason = ?, completed_at = ?
         WHERE execution_id = ? AND tick_number = ?`,
      )
      .run(
        model ?? null,
        usage ? JSON.stringify(usage) : null,
        stopReason ?? null,
        Date.now(),
        executionId,
        tickNumber,
      );
  }

  /** execution_end → UPDATE execution record */
  completeExecution(executionId: string, status: string, tickCount: number, error?: string): void {
    this.db
      .prepare(
        `UPDATE executions SET status = ?, tick_count = ?, error = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, tickCount, error ?? null, Date.now(), executionId);
  }

  // ==========================================================================
  // SessionStore interface (save/load/delete/list/has)
  // ==========================================================================

  async save(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const now = Date.now();

    this.db.exec("BEGIN");
    try {
      // 1. Upsert session row (no usage — derived from ticks)
      this.db
        .prepare(
          `INSERT INTO sessions (id, tick, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             tick = excluded.tick,
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .run(sessionId, snapshot.tick, snapshot.version, now, now);

      // 2. Fallback: persist any timeline entries not yet committed
      //    (e.g., restored from snapshot without execution context)
      if (snapshot.timeline && snapshot.timeline.length > 0) {
        const existingRows = this.db
          .prepare("SELECT id FROM messages WHERE session_id = ?")
          .all(sessionId) as { id: string }[];
        const existingIds = new Set(existingRows.map((r) => r.id));

        const insertMessage = this.db.prepare(
          `INSERT OR IGNORE INTO messages
           (id, session_id, role, tick, sequence_in_tick, text_preview, visibility, tags, tokens, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        const insertBlock = this.db.prepare(
          `INSERT OR IGNORE INTO content_blocks (id, message_id, position, block_type, text_content, content_json, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );

        for (let i = 0; i < snapshot.timeline.length; i++) {
          const entry = snapshot.timeline[i];
          const messageId = entry.id ?? randomUUID();

          if (existingIds.has(messageId)) continue;

          const textPreview = truncatePreview(extractText(entry.message.content as ContentBlock[]));

          insertMessage.run(
            messageId,
            sessionId,
            entry.message.role,
            snapshot.tick,
            i,
            textPreview || null,
            entry.visibility ?? null,
            entry.tags ? JSON.stringify(entry.tags) : null,
            entry.tokens ?? null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            now,
          );

          const content = entry.message.content as ContentBlock[];
          for (let pos = 0; pos < content.length; pos++) {
            const block = content[pos];
            const stripped = stripTransientFields(block);
            insertBlock.run(
              randomUUID(),
              messageId,
              pos,
              extractBlockType(block),
              extractTextContent(block),
              JSON.stringify(stripped),
              null,
            );
          }
        }
      }

      // 3. Persist comState as single JSON blob in session_snapshots
      if (snapshot.comState) {
        // Delete all existing keys, then re-insert
        this.db
          .prepare("DELETE FROM session_snapshots WHERE session_id = ? AND key = ?")
          .run(sessionId, "com_state");

        this.db
          .prepare(
            `INSERT INTO session_snapshots (session_id, key, value, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(sessionId, "com_state", JSON.stringify(snapshot.comState), now);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadSync(sessionId: string): SessionSnapshot | null {
    // 1. Load session row
    const session = row<SessionRow>(
      this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId),
    );
    if (!session) return null;

    // 2. Load messages ordered by (tick, sequence_in_tick)
    const messages = rows<MessageRow>(
      this.db
        .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY tick, sequence_in_tick")
        .all(sessionId),
    );

    // 3. Load all content blocks via subquery (scales to any message count)
    const blocksByMessage = new Map<string, ContentBlockRow[]>();
    if (messages.length > 0) {
      const blocks = rows<ContentBlockRow>(
        this.db
          .prepare(
            `SELECT cb.* FROM content_blocks cb
             WHERE cb.message_id IN (SELECT id FROM messages WHERE session_id = ?)
             ORDER BY cb.message_id, cb.position`,
          )
          .all(sessionId),
      );

      for (const block of blocks) {
        let arr = blocksByMessage.get(block.message_id);
        if (!arr) {
          arr = [];
          blocksByMessage.set(block.message_id, arr);
        }
        arr.push(block);
      }
    }

    // 4. Reconstruct COMTimelineEntry[] from messages + blocks
    const timeline: COMTimelineEntry[] = messages.map((msg) => {
      const blocks = blocksByMessage.get(msg.id) ?? [];
      const content = blocks.map((b) => JSON.parse(b.content_json) as ContentBlock);

      return {
        id: msg.id,
        kind: "message" as const,
        message: {
          id: msg.id,
          role: msg.role as COMTimelineEntry["message"]["role"],
          content,
          metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
        },
        visibility: msg.visibility as COMTimelineEntry["visibility"],
        tags: msg.tags ? JSON.parse(msg.tags) : undefined,
        tokens: msg.tokens ?? undefined,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
      };
    });

    // 5. Load comState from session_snapshots
    const comStateRow = row<SessionSnapshotRow>(
      this.db
        .prepare("SELECT value FROM session_snapshots WHERE session_id = ? AND key = ?")
        .get(sessionId, "com_state"),
    );
    const comState: Record<string, unknown> = comStateRow ? JSON.parse(comStateRow.value) : {};

    // 6. Aggregate usage from ticks via executions
    const usageRow = row<{ input_tokens: number; output_tokens: number }>(
      this.db
        .prepare(
          `SELECT
             COALESCE(SUM(json_extract(t.usage, '$.inputTokens')), 0) as input_tokens,
             COALESCE(SUM(json_extract(t.usage, '$.outputTokens')), 0) as output_tokens
           FROM ticks t
           JOIN executions e ON t.execution_id = e.id
           WHERE e.session_id = ? AND t.usage IS NOT NULL`,
        )
        .get(sessionId),
    );

    const usage =
      usageRow && (usageRow.input_tokens > 0 || usageRow.output_tokens > 0)
        ? {
            inputTokens: usageRow.input_tokens,
            outputTokens: usageRow.output_tokens,
            totalTokens: usageRow.input_tokens + usageRow.output_tokens,
          }
        : undefined;

    return {
      version: session.version,
      sessionId,
      tick: session.tick,
      timeline: timeline.length > 0 ? timeline : null,
      comState,
      dataCache: {},
      usage,
      timestamp: session.updated_at,
    };
  }

  async load(sessionId: string): Promise<SessionSnapshot | null> {
    return this.loadSync(sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    // CASCADE handles messages, content_blocks, executions, ticks, session_snapshots
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  async list(): Promise<string[]> {
    const rows = this.db.prepare("SELECT id FROM sessions ORDER BY updated_at DESC").all() as {
      id: string;
    }[];
    return rows.map((r) => r.id);
  }

  async has(sessionId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 FROM sessions WHERE id = ? LIMIT 1").get(sessionId);
    return row !== undefined;
  }
}
