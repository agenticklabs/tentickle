import type { SandboxHandle } from "@agentick/sandbox";

let _sandbox: SandboxHandle | null = null;

export function bindSandbox(sandbox: SandboxHandle): void {
  _sandbox = sandbox;
}

export function getSandbox(): SandboxHandle | null {
  return _sandbox;
}
