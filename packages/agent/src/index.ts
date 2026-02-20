// Base agent component
export { TentickleAgent, useTentickle } from "./agent.js";
export type { TentickleAgentProps } from "./agent.js";

// Sub-components (for consumers who need finer control)
export { Identity } from "./identity.js";
export { DynamicModel } from "./model.js";
export { WorkspaceGrounding, ProjectConventions } from "./grounding.js";
export { Memory, ClaudeMemory } from "./memory.js";
export { Skills } from "./skills.js";
export { EnhancedTimeline } from "./timeline.js";
export { UserContext } from "./user-context.js";
export { EntityAwareness } from "./entities.js";
export { Rules } from "./rules.js";
export {
  truncateEdges,
  hasMultimodal,
  userMultimodalSummary,
  toolResultSummary,
} from "./timeline.js";

// Task store
export { TaskStore, bindTaskStore, getTaskStore } from "./task-store.js";
export type { Task } from "./task-store.js";

// Tool factories (consumer creates their own instances)
export { createTaskTool } from "./tools/task-list.js";
export { createSpawnTool } from "./tools/spawn.js";
export { createExploreTool } from "./tools/explore.js";
export { AddDirCommand } from "./tools/add-dir.js";

// Path helpers
export {
  getDataDir,
  getDbPath,
  getMediaDir,
  getIdentityPath,
  getProjectDir,
  getMemoryPath,
  getClaudeMemoryDir,
  getSkillsDirs,
  getUserDir,
  getEntitiesDir,
  getProfilesDir,
  getGlobalRulesDir,
  getProjectRulesDir,
} from "./paths.js";

// App factory
export { createTentickleApp } from "./app.js";
export type { TentickleAppOptions, TentickleAppResult } from "./app.js";

// Storage (re-export from @tentickle/storage)
export {
  openDatabase,
  TentickleSessionStore,
  ensureStorageSchema,
  bindSessionStore,
  getSessionStore,
} from "@tentickle/storage";
export type { OpenDatabaseOptions } from "@tentickle/storage";

// Memory (re-export from @tentickle/memory)
export {
  TentickleMemory,
  ensureMemorySchema,
  bindMemory,
  getMemory,
  createRememberTool,
  createRecallTool,
} from "@tentickle/memory";
export type {
  EmbedFn,
  VecOptions,
  RememberInput,
  MemoryEntry,
  RecallQuery,
  RecallResult,
  ScoredMemoryEntry,
} from "@tentickle/memory";

// Settings
export {
  loadSettings,
  scaffoldGlobalDataDir,
  scaffoldProjectDir,
  writeGlobalSettings,
  writeProjectSettings,
  writeProjectLocalSettings,
} from "./settings.js";
export type { TentickleSettings } from "./settings.js";

// Connectors (shared env-var-based startup)
export { startConnectors } from "./connectors.js";
export type { ConnectorHandle } from "./connectors.js";

// Utilities
export { fileAge } from "./utils.js";
