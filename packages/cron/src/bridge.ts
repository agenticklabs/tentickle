import type { JobStore } from "./job-store.js";

let _store: JobStore | null = null;

export function bindCronStore(store: JobStore): void {
  _store = store;
}

export function getCronStore(): JobStore | null {
  return _store;
}
