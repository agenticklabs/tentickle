import type { TentickleMemory } from "./tentickle-memory.js";

let _memory: TentickleMemory | null = null;

export function bindMemory(memory: TentickleMemory): void {
  _memory = memory;
}

export function getMemory(): TentickleMemory | null {
  return _memory;
}
