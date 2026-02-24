import React from "react";
import { System, Section, Ephemeral } from "@agentick/core";
import { getSessionStore, type TentickleSessionStore } from "@tentickle/storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegationRole = "delegate" | "supervisor";

export interface DelegationMetadata {
  sessionId: string;
  role: DelegationRole;
  objective: string;
  title: string;
  supervisorCriteria?: string;
  parentSessionId: string;
  delegateSessionId?: string;
}

// ---------------------------------------------------------------------------
// Role detection — queries session store directly
// ---------------------------------------------------------------------------

export function getDelegationMetadata(sessionId: string | undefined): DelegationMetadata | null {
  if (!sessionId) return null;
  const store = getSessionStore();
  if (!store) return null;
  return getDelegationMetadataFromStore(store, sessionId);
}

export function getDelegationMetadataFromStore(
  store: TentickleSessionStore,
  sessionId: string,
): DelegationMetadata | null {
  const session = store.getSessionMeta(sessionId);
  if (!session) return null;

  if (session.session_type === "delegation") {
    const objective = store.getSnapshotValue(sessionId, "objective") ?? "";
    return {
      sessionId,
      role: "delegate",
      objective,
      title: session.title ?? "",
      parentSessionId: session.parent_session_id ?? "",
    };
  }

  if (session.session_type === "supervision") {
    const objective = store.getSnapshotValue(sessionId, "objective") ?? "";
    const criteria = store.getSnapshotValue(sessionId, "criteria") ?? undefined;
    // Find the delegate child (delegation session whose parent is this supervisor)
    const children = store.getChildSessions(sessionId);
    const delegateChild = children.find((c) => c.session_type === "delegation");
    return {
      sessionId,
      role: "supervisor",
      objective,
      title: session.title ?? "",
      supervisorCriteria: criteria,
      parentSessionId: session.parent_session_id ?? "",
      delegateSessionId: delegateChild?.id,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// DelegateContext — renders spec + instructions for delegate role
// ---------------------------------------------------------------------------

export function DelegateContext({ delegation }: { delegation: DelegationMetadata }) {
  const mode = delegation.supervisorCriteria ? "supervised" : "autonomous";

  return (
    <>
      <System>
        You are working as a delegated agent ({mode} mode).
        {mode === "supervised"
          ? " A supervisor is reviewing your work. Focus on the spec below and respond thoroughly."
          : " You are working autonomously. Self-verify your work before reporting completion."}
      </System>

      <Section id="delegation-spec" title="Delegation Spec">
        <h3>{delegation.title}</h3>
        {delegation.objective}
      </Section>

      {mode === "autonomous" && (
        <Ephemeral>
          When you finish the task, provide a clear summary of what you did and any verification
          results. If you get stuck and cannot make progress, use notify_parent with type
          "escalation" to alert the parent session.
        </Ephemeral>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SupervisorContext — renders review-focused prompt + criteria
// ---------------------------------------------------------------------------

export function SupervisorContext({ delegation }: { delegation: DelegationMetadata }) {
  return (
    <>
      <System>
        You are a code review supervisor. Your job is to ensure the coding agent produces correct,
        well-tested code that meets the acceptance criteria below. Your workflow: 1. Send the spec
        to the coding agent via send_session 2. Review the response — check for correctness,
        completeness, edge cases 3. Run independent verification (tests, typecheck) via
        run_verification 4. If issues found, send feedback via send_session with specific fixes
        needed 5. Repeat until all acceptance criteria are met 6. Call notify_parent with type
        "completion" and a summary You do NOT write code yourself. You review and direct the coding
        agent.
      </System>

      <Section id="delegation-spec" title="Task">
        <h3>{delegation.title}</h3>
        {delegation.objective}
      </Section>

      {delegation.supervisorCriteria && (
        <Section id="acceptance-criteria" title="Acceptance Criteria">
          {delegation.supervisorCriteria}
        </Section>
      )}
    </>
  );
}
