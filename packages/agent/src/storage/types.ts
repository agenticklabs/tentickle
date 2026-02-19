/** Internal row types matching SQL columns. Not exported from package. */

export interface SessionRow {
  id: string;
  parent_session_id: string | null;
  session_type: string;
  fork_after_message_id: string | null;
  title: string | null;
  workspace: string | null;
  status: string;
  owner_entity_id: string | null;
  tick: number;
  version: string;
  created_at: number;
  updated_at: number;
}

export interface ExecutionRow {
  id: string;
  session_id: string;
  trigger_type: string;
  status: string;
  tick_count: number;
  error: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface TickRow {
  execution_id: string;
  tick_number: number;
  model: string | null;
  usage: string | null;
  stop_reason: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface MessageRow {
  id: string;
  session_id: string;
  entity_id: string | null;
  execution_id: string | null;
  role: string;
  tick: number;
  sequence_in_tick: number;
  text_preview: string | null;
  visibility: string | null;
  tags: string | null;
  tokens: number | null;
  metadata: string | null;
  created_at: number;
}

export interface ContentBlockRow {
  id: string;
  message_id: string;
  position: number;
  block_type: string;
  text_content: string | null;
  content_json: string;
  metadata: string | null;
}

export interface SessionSnapshotRow {
  session_id: string;
  key: string;
  value: string;
  updated_at: number;
}
