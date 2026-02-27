import type { ArtifactStore } from "./artifact-store.js";

let _store: ArtifactStore | null = null;

export function bindArtifactStore(store: ArtifactStore): void {
  _store = store;
}

export function getArtifactStore(): ArtifactStore | null {
  return _store;
}
