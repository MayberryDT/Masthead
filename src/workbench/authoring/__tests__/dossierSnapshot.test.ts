import { describe, expect, test } from "vitest";
import type { EvidenceRef } from "../../../core/types.ts";
import type {
  ReadableSessionDossier,
  SessionDossierDto
} from "../../../shared/sessionDossier.ts";
import {
  buildPublishedEnrichedDossierSnapshot,
  buildPublishedDossierSnapshot,
  dossierEvidenceRefs,
  dossierSnapshotFingerprint
} from "../dossierSnapshot.ts";

describe("published session dossier snapshot", () => {
  test("refuses to snapshot a dossier without current durable enrichment", () => {
    const dossier = fixtureSessionDossier();
    dossier.durableEnrichment = undefined;
    dossier.enrichment.status = "not_enriched";

    expect(() => buildPublishedEnrichedDossierSnapshot(dossier)).toThrow(
      "session_dossier_requires_current_enrichment"
    );
  });

  test("preserves every original human-facing section without recursive artifacts", () => {
    const canonical = fixtureSessionDossier();

    const snapshot = buildPublishedDossierSnapshot(canonical, "2026-07-12T18:00:00.000Z");

    expect(snapshot).toMatchObject({
      attention: canonical.attention,
      coverage: canonical.coverage,
      durableEnrichment: canonical.durableEnrichment,
      enrichment: canonical.enrichment,
      excerpts: canonical.excerpts,
      files: canonical.files,
      identity: canonical.identity,
      narrative: canonical.narrative,
      reuse: canonical.reuse,
      timeline: canonical.timeline,
      tools: canonical.tools,
      usage: canonical.usage,
      verification: canonical.verification
    });
    expect(snapshot).not.toHaveProperty("artifacts");
    expect(snapshot.snapshotVersion).toBe("canonical-session-dossier-v1");
    expect(snapshot.capturedAt).toBe("2026-07-12T18:00:00.000Z");
  });

  test("deeply detaches the snapshot from later source mutations", () => {
    const canonical = fixtureSessionDossier();
    const snapshot = buildPublishedDossierSnapshot(canonical);

    canonical.identity.title = "Mutated title";
    canonical.narrative.topics.push("mutated-topic");
    canonical.files[0]!.sourceRef = { id: "mutated-file-ref" };
    canonical.artifacts[0]!.content = { recursive: "mutation" };

    expect(snapshot.identity.title).toBe("Restore the canonical dossier");
    expect(snapshot.narrative.topics).toEqual(["durable-memory"]);
    expect(snapshot.files[0]!.sourceRef).toEqual({ id: "file:1" });
    expect(snapshot).not.toHaveProperty("artifacts");
  });

  test("survives a JSON round trip", () => {
    const snapshot = buildPublishedDossierSnapshot(fixtureSessionDossier(), "2026-07-12T18:00:00.000Z");

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test("is readable through the same contract as a live dossier", () => {
    const live: ReadableSessionDossier = fixtureSessionDossier();
    const published: ReadableSessionDossier = buildPublishedDossierSnapshot(fixtureSessionDossier());

    expect(live.artifacts).toHaveLength(1);
    expect(published.artifacts).toBeUndefined();
    expect(published.identity.title).toBe(live.identity.title);
  });

  test("fingerprints every snapshot field except capturedAt", () => {
    const first = buildPublishedDossierSnapshot(fixtureSessionDossier(), "2026-07-12T18:00:00.000Z");
    const recaptured = buildPublishedDossierSnapshot(fixtureSessionDossier(), "2026-07-12T19:00:00.000Z");
    const reuseChanged = buildPublishedDossierSnapshot(fixtureSessionDossier(), "2026-07-12T18:00:00.000Z");
    reuseChanged.reuse.mcpIncluded = !first.reuse.mcpIncluded;
    reuseChanged.reuse.copyableContext = "Publication-derived presentation changed.";
    const changed = buildPublishedDossierSnapshot(fixtureSessionDossier(), "2026-07-12T18:00:00.000Z");
    changed.narrative.objective = "A substantively changed objective";

    expect(dossierSnapshotFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(dossierSnapshotFingerprint(recaptured)).toBe(dossierSnapshotFingerprint(first));
    expect(dossierSnapshotFingerprint(reuseChanged)).not.toBe(dossierSnapshotFingerprint(first));
    expect(dossierSnapshotFingerprint(changed)).not.toBe(dossierSnapshotFingerprint(first));
  });

  test("collects and deterministically deduplicates canonical evidence refs from every dossier section", () => {
    const snapshot = buildPublishedDossierSnapshot(fixtureSessionDossier());

    expect(dossierEvidenceRefs(snapshot)).toEqual([
      "attention:1",
      "excerpt:1",
      "file:1",
      "narrative:1",
      "timeline:1",
      "tool:1"
    ]);
  });

  test("collects evidence refs from every durable enrichment section", () => {
    const snapshot = buildPublishedDossierSnapshot(fixtureSessionDossier());
    snapshot.durableEnrichment!.sessionTitle.evidenceRefs = [evidenceRef("durable:title")];
    snapshot.durableEnrichment!.sessionSummary.evidenceRefs = [evidenceRef("durable:summary")];
    snapshot.durableEnrichment!.sessionDossier.evidenceRefs = [evidenceRef("durable:dossier")];
    snapshot.durableEnrichment!.sessionDossier.verification.evidenceRefs = [
      evidenceRef("durable:verification")
    ];

    expect(dossierEvidenceRefs(snapshot)).toEqual([
      "attention:1",
      "durable:dossier",
      "durable:summary",
      "durable:title",
      "durable:verification",
      "excerpt:1",
      "file:1",
      "narrative:1",
      "timeline:1",
      "tool:1"
    ]);
  });

  test("collects explicit canonical refs from nested sourceRef arrays", () => {
    const snapshot = buildPublishedDossierSnapshot(fixtureSessionDossier());
    snapshot.excerpts[0]!.sourceRef = [
      " array:string ",
      [{ id: "array:object" }, ["array:string", { id: "  " }]],
      { source: "not-an-evidence-ref" }
    ];

    expect(dossierEvidenceRefs(snapshot)).toEqual([
      "array:object",
      "array:string",
      "attention:1",
      "file:1",
      "narrative:1",
      "timeline:1",
      "tool:1"
    ]);
  });
});

function fixtureSessionDossier(): SessionDossierDto {
  const narrativeRef = evidenceRef("narrative:1");
  return {
    artifacts: [
      {
        artifactId: "artifact:old",
        artifactKind: "session_dossier",
        content: { recursive: true },
        createdAt: "2026-07-12T17:00:00.000Z",
        evidenceRefs: ["old:artifact"],
        status: "current",
        updatedAt: "2026-07-12T17:00:00.000Z"
      }
    ],
    attention: [
      {
        kind: "missing_verification",
        severity: "P2",
        sourceRefs: [evidenceRef("attention:1"), narrativeRef],
        title: "Verification needs review"
      }
    ],
    coverage: {
      level: "complete",
      transcript: {
        assistantMessages: 2,
        checkpoints: 1,
        fileEffects: 1,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 3,
        runtimeSignals: 1,
        toolCalls: 1,
        toolResults: 1,
        userMessages: 1
      },
      warnings: []
    },
    durableEnrichment: {
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], openQuestions: [] },
        decisions: ["Keep the original dossier."],
        evidenceRefs: [narrativeRef],
        keyWork: ["Recovered the canonical snapshot."],
        verification: {
          commands: ["npm test"],
          evidenceRefs: [narrativeRef],
          failures: [],
          status: "passed",
          summary: "Focused tests passed."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [narrativeRef],
        state: "completed",
        text: "Canonical dossier snapshot restored."
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [narrativeRef],
        text: "Restore the canonical dossier"
      },
      version: "session-capsule-v4"
    },
    enrichment: { generatedAt: "2026-07-12T17:00:00.000Z", status: "current" },
    excerpts: [
      {
        excerptId: "message:1",
        kind: "message",
        observedAt: "2026-07-12T16:00:00.000Z",
        sourceRef: { id: "excerpt:1" },
        text: "Keep the original dossier."
      }
    ],
    files: [
      {
        basename: "sessionDossier.ts",
        displayPath: "src/shared/sessionDossier.ts",
        effectKind: "modified",
        fileEffectId: "file-effect:1",
        observedAt: "2026-07-12T16:05:00.000Z",
        path: "src/shared/sessionDossier.ts",
        sourceRef: { id: "file:1" },
        staged: false
      }
    ],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-07-12T17:00:00.000Z",
      lifecycle: "ended",
      models: ["gpt-5.6"],
      runtime: "codex",
      sessionId: "session:canonical",
      sourceConfidence: "authoritative",
      sourceSessionId: "source:canonical",
      title: "Restore the canonical dossier"
    },
    narrative: {
      narrativeDebug: { sourceRefs: [narrativeRef] },
      objective: "Restore the original human-readable dossier.",
      technologies: ["TypeScript"],
      topics: ["durable-memory"],
      unresolved: []
    },
    reuse: {
      canonicalSessionId: "session:canonical",
      copyableContext: "# Restore the canonical dossier",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source:canonical"
    },
    timeline: [
      {
        eventId: "timeline-event:1",
        kind: "assistant",
        label: "assistant",
        observedAt: "2026-07-12T16:10:00.000Z",
        sourceRef: { id: "timeline:1" },
        summary: "Implemented the canonical snapshot."
      }
    ],
    tools: [
      {
        sourceRef: { id: "tool:1" },
        toolCallId: "tool-call:1",
        toolName: "npm test"
      }
    ],
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, usageRows: 1 },
    verification: {
      commands: [],
      status: "passed",
      summary: "Focused snapshot tests passed."
    }
  };
}

function evidenceRef(id: string): EvidenceRef {
  return {
    id,
    kind: "event",
    observedAt: "2026-07-12T16:00:00.000Z",
    source: "test"
  };
}
