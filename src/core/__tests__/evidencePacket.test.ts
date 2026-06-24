import { describe, expect, test } from "vitest";
import { buildEvidencePacket } from "../evidencePacket";
import { validateLlmAttentionItem } from "../llmAttention";
import type { AttentionItem, DerivedSession, EvidenceRef, NormalizedEvent } from "../types";

const observedAt = "2026-06-23T02:00:00.000Z";

const evidenceRef = (id: string): EvidenceRef => ({
  id,
  kind: "event",
  observedAt,
  source: "codex.fixture"
});

const event = (
  eventId: string,
  type: NormalizedEvent["type"],
  payload: Record<string, unknown>,
  evidence: EvidenceRef[] = [evidenceRef(eventId)]
): NormalizedEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "session-1",
  source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
  occurredAt: observedAt,
  receivedAt: observedAt,
  type,
  workspace: { repoRoot: "/work/app", branch: "feature/context" },
  summary: "Command finished with Authorization: Bearer live-token",
  payload,
  sensitivity: "metadata",
  payloadHash: `hash-${eventId}`,
  evidence
});

const session: DerivedSession = {
  sessionId: "session-1",
  project: "App",
  title: "Auth cleanup",
  objective: "Make auth tests pass",
  primaryStatus: "completed_unreviewed",
  lifecycle: "ended",
  outcomeLabel: "needs_attention",
  endReason: "completed",
  endedAt: observedAt,
  lastEventType: "session.completed",
  flags: ["no_tests_observed"],
  lastMeaningfulActivityAt: observedAt,
  attribution: "direct",
  workspace: { repoRoot: "/work/app", branch: "feature/context" },
  changedFileCount: 2,
  evidence: [evidenceRef("event-command")]
};

const attentionItem: AttentionItem = {
  itemId: "attention:session-1:verification",
  sessionId: "session-1",
  project: "App",
  type: "completed_without_verification",
  severity: "P2",
  title: "Completed without observed verification",
  createdAt: observedAt,
  affectedPaths: ["src/auth/session.ts"],
  affectedCommandIds: ["cmd-1"],
  evidence: [evidenceRef("event-command")],
  support: "deterministic",
  suggestedNextAction: "Review the diff and run tests."
};

describe("evidence packet builder", () => {
  test("blocks remote LLM by default and exposes an unsupported candidate the validator rejects", () => {
    const packet = buildEvidencePacket({
      createdAt: observedAt,
      events: [event("event-command", "command.finished", { commandId: "cmd-1", exitCode: 1 })]
    });

    expect(packet.privacy.remoteLlmEnabled).toBe(false);
    expect(packet.payloadPreview.sendAllowed).toBe(false);
    expect(packet.auditDecision).toMatchObject({
      decision: "remote_send_blocked",
      reason: "remote_llm_disabled_by_default",
      requiresExplicitOptIn: true
    });

    expect(validateLlmAttentionItem(packet.auditDecision.fallbackCandidate, packet.evidenceRefs)).toEqual({
      ok: false,
      reason: "llm_attention_requires_evidence"
    });
  });

  test("builds observed inferred and missing sections from redacted evidence", () => {
    const packet = buildEvidencePacket({
      createdAt: observedAt,
      events: [
        event("event-command", "command.finished", {
          commandId: "cmd-1",
          command: "curl -H 'Authorization: Bearer live-token' https://example.test",
          exitCode: 1,
          stdout: "full output should stay local",
          stderr: "DATABASE_URL=postgres://user:secret@example.test/app",
          diff: "diff --git a/src/auth/session.ts b/src/auth/session.ts\n+secret",
          prompt: "raw user prompt should stay local"
        }),
        event("event-no-evidence", "file.changed", { path: "src/auth/session.ts" }, [])
      ],
      sessions: [session],
      attentionItems: [attentionItem]
    });

    expect(packet.sections.observed.map((entry) => entry.id)).toEqual(["event-command"]);
    expect(packet.sections.inferred.map((entry) => entry.id)).toEqual([
      "session:session-1",
      "attention:session-1:verification"
    ]);
    expect(packet.sections.missing).toEqual([
      {
        id: "missing:event-no-evidence",
        subject: "event-no-evidence",
        reason: "event_has_no_evidence_refs"
      }
    ]);
    expect(packet.evidenceRefs.map((ref) => ref.id)).toEqual(["event-command"]);
  });

  test("redacts summaries and omits raw prompts full diffs and full command output from preview", () => {
    const packet = buildEvidencePacket({
      createdAt: observedAt,
      privacy: { remoteLlmEnabled: true },
      events: [
        event("event-command", "command.finished", {
          commandId: "cmd-1",
          command: "curl -H 'Authorization: Bearer live-token' https://example.test",
          exitCode: 1,
          stdout: "full output should stay local",
          stderr: "DATABASE_URL=postgres://user:secret@example.test/app",
          diff: "diff --git a/src/auth/session.ts b/src/auth/session.ts\n+secret",
          prompt: "raw user prompt should stay local"
        })
      ]
    });
    const serialized = JSON.stringify(packet);

    expect(serialized).toContain("[SECRET:bearer_token]");
    expect(serialized).not.toContain("live-token");
    expect(serialized).not.toContain("raw user prompt should stay local");
    expect(serialized).not.toContain("diff --git");
    expect(serialized).not.toContain("full output should stay local");
    expect(serialized).not.toContain("postgres://user:secret");
    expect(packet.privacy.omittedByDefault).toEqual(["raw_prompts", "full_diffs", "full_command_output"]);
    expect(packet.payloadPreview.sendAllowed).toBe(true);
    expect(packet.auditDecision).toMatchObject({
      decision: "remote_send_ready",
      reason: "remote_llm_enabled_with_redacted_preview",
      requiresExplicitOptIn: false
    });
  });
});
