import type { TentickleSessionStore } from "./session-store.js";

let _sessionStore: TentickleSessionStore | null = null;

export function bindSessionStore(store: TentickleSessionStore): void {
  _sessionStore = store;
}

export function getSessionStore(): TentickleSessionStore | null {
  return _sessionStore;
}
