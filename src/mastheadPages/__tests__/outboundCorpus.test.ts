import { describe, expect, test } from "vitest";

import type { EvidenceRef } from "../../core/types.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { validatePageRevisionV1, validatePublishPageRequestV1 } from "../contract.ts";
import { scanCompleteOutboundRequest, scanPageEgress } from "../egressPreflight.ts";
import {
  resolvePublicEvidenceCandidates,
  type PublicEvidenceSelection,
} from "../evidence.ts";
import { computePageObjectId } from "../objectIdentity.ts";
import { projectSessionDossier } from "../publicProjection.ts";
import type { EvidenceItemV1, PublishPageRequestV1 } from "../types.ts";
import type { WorkbenchValidationEvidence } from "../../workbench/types.ts";

const PRIVATE_SESSION_ID = "session:private-alpha-do-not-leak";
const PRIVATE_SOURCE_ID = "source:private-alpha-do-not-leak";
const PRIVATE_REPO_ROOT = "/home/secret/repo-root-path";
const PRIVATE_FIRST_PROMPT = "SECRET_FIRST_USER_PROMPT_VALUE";
const PRIVATE_TOOL_OUTPUT = "SECRET_TOOL_OUTPUT_VALUE";
const PRIVATE_FINGERPRINT = "fp-private-local-only";

const narrativeRef: EvidenceRef = {
  id: "msg:1",
  kind: "event",
  observedAt: "2026-08-11T10:00:00.000Z",
  source: "test",
};

function durableEnrichment() {
  return {
    version: "session-capsule-v4" as const,
    keywords: ["projection", "allowlist"],
    sessionTitle: {
      text: "Ship portable public projection",
      basis: "dominant_work" as const,
      confidence: "high" as const,
      evidenceRefs: [narrativeRef],
    },
    sessionSummary: {
      text: "Built the narrow session-dossier public projection allowlist.",
      state: "completed" as const,
      confidence: "high" as const,
      evidenceRefs: [narrativeRef],
    },
    sessionDossier: {
      purpose: "Project only approved durable fields.",
      outcome: "PageRevisionV1 is constructed without private sections.",
      keyWork: ["Allowlist durable enrichment", "Exclude private sections"],
      decisions: ["No prompt fallback", "Explicit field construction only"],
      blockers: [],
      verification: {
        status: "passed" as const,
        summary: "Projection unit tests passed.",
        commands: ["npm test -- --run src/mastheadPages"],
        failures: [],
        evidenceRefs: [narrativeRef],
      },
      continuation: {
        nextStep: "Resolve reviewed evidence",
        openQuestions: [],
        constraints: ["No raw transcripts"],
      },
      evidenceRefs: [narrativeRef],
      warnings: [],
    },
  };
}

function completeDossier(): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    capturedAt: "2026-08-11T12:34:56.789Z",
    identity: {
      sessionId: PRIVATE_SESSION_ID,
      sourceSessionId: PRIVATE_SOURCE_ID,
      title: "Private identity title must not win",
      runtime: "codex",
      model: "gpt-secret",
      models: ["gpt-secret"],
      hostId: "host:private",
      branch: "feature/secret",
      repoRoot: PRIVATE_REPO_ROOT,
      worktreePath: "/home/secret/worktree",
      lastActivityAt: "2026-08-11T12:00:00.000Z",
      lifecycle: "ended",
      startedAt: "2026-08-10T09:15:30.000Z",
      endedAt: "2026-08-11T18:45:00.000Z",
      sourceConfidence: "authoritative",
    },
    enrichment: {
      status: "current",
      generatedAt: "2026-08-11T11:00:00.000Z",
      provider: "secret-provider",
      model: "secret-model",
    },
    durableEnrichment: durableEnrichment(),
    coverage: {
      level: "complete",
      warnings: [],
      transcript: {
        hasUsableTranscript: true,
        messages: 4,
        userMessages: 2,
        assistantMessages: 2,
        toolCalls: 1,
        toolResults: 1,
        fileEffects: 1,
        checkpoints: 0,
        runtimeSignals: 0,
        lowValueItems: 0,
      },
    },
    narrative: {
      firstUserPrompt: PRIVATE_FIRST_PROMPT,
      latestUserPrompt: "SECRET_LATEST_PROMPT",
      finalAssistantMessage: "SECRET_ASSISTANT_MESSAGE",
      objective: "private objective",
      topics: ["do-not-auto-include"],
      technologies: ["typescript"],
      unresolved: [],
    },
    files: [
      {
        fileEffectId: "file-effect:1",
        path: `${PRIVATE_REPO_ROOT}/src/private.ts`,
        displayPath: "src/private.ts",
        basename: "private.ts",
        effectKind: "modified",
        staged: false,
        observedAt: "2026-08-11T10:00:00.000Z",
        sourceRef: { id: "file:1" },
      },
    ],
    tools: [
      {
        toolCallId: "tool-call:1",
        toolName: "bash",
        outputPreview: PRIVATE_TOOL_OUTPUT,
        sourceRef: { id: "tool:1" },
      },
    ],
    verification: { status: "passed", summary: "local", commands: [] },
    attention: [],
    excerpts: [
      {
        excerptId: "excerpt:private",
        kind: "message",
        text: "SECRET_EXCERPT_TEXT",
        observedAt: "2026-08-11T10:00:00.000Z",
        sourceRef: { id: "excerpt:1" },
      },
    ],
    timeline: [],
    reuse: {
      mcpIncluded: true,
      sourceRuntime: "codex",
      sourceSessionId: PRIVATE_SOURCE_ID,
      sourceConfidence: "authoritative",
      canonicalSessionId: PRIVATE_SESSION_ID,
      copyableContext: "SECRET_COPYABLE_CONTEXT",
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      usageRows: 3,
    },
  } as unknown as PublishedSessionDossierV1;
}

function localEvidence(id: string, text: string): WorkbenchValidationEvidence {
  return {
    sessionId: PRIVATE_SESSION_ID,
    kind: "message",
    role: "assistant",
    text,
    observedAt: "2026-08-11T12:00:00.000Z",
    label: id,
    lowValue: false,
  };
}

function buildOutbound(options: {
  evidenceSelections?: PublicEvidenceSelection[];
  keyWorkOverride?: string[];
} = {}): { page: ReturnType<typeof projectSessionDossier>; request: PublishPageRequestV1; selected: EvidenceItemV1[] } {
  const dossier = completeDossier();
  if (options.keyWorkOverride) {
    dossier.durableEnrichment!.sessionDossier.keyWork = options.keyWorkOverride;
  }

  const evidenceByRef = new Map([
    ["message:selected", localEvidence("message:selected", "Publisher-selected public-safe excerpt.")],
    ["message:unselected", localEvidence("message:unselected", "UNSELECTED_EVIDENCE_MUST_NOT_APPEAR")],
  ]);
  const selections = options.evidenceSelections ?? [
    {
      ref: "message:selected",
      kind: "excerpt" as const,
      label: "Acceptance note",
      supports: ["outcome" as const],
    },
  ];
  const selected = resolvePublicEvidenceCandidates(evidenceByRef, {
    sessionId: PRIVATE_SESSION_ID,
    selections,
  });

  const page = projectSessionDossier({
    dossier,
    license: "all-rights-reserved",
    generatorVersion: "0.1.15",
    evidence: selected,
    topics: ["contracts"],
    technologies: ["typescript"],
    includeSourceDate: true,
  });

  const request: PublishPageRequestV1 = {
    protocolVersion: "masthead-pages-publish-v1",
    publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
    slug: "outbound-corpus-page",
    idempotencyKey: "b4d8a1f1-5e76-4cc0-a3a8-4dcfbcce9d31",
    objectId: computePageObjectId(page),
    object: page,
  };

  return { page, request, selected };
}

const FORBIDDEN_SUBSTRINGS = [
  PRIVATE_SESSION_ID,
  PRIVATE_SOURCE_ID,
  PRIVATE_REPO_ROOT,
  PRIVATE_FIRST_PROMPT,
  PRIVATE_TOOL_OUTPUT,
  PRIVATE_FINGERPRINT,
  "SECRET_EXCERPT_TEXT",
  "SECRET_LATEST_PROMPT",
  "SECRET_ASSISTANT_MESSAGE",
  "SECRET_COPYABLE_CONTEXT",
  "UNSELECTED_EVIDENCE_MUST_NOT_APPEAR",
  "secret-provider",
  "secret-model",
  "gpt-secret",
  "host:private",
  "/home/secret/worktree",
  "rawTranscript",
  "transcriptRows",
  "inputTokens",
  "artifactId",
  "contentFingerprint",
];

describe("outbound corpus privacy", () => {
  test("projected request excludes private local fields and unselected evidence", () => {
    const { page, request, selected } = buildOutbound();

    expect(validatePageRevisionV1(page).ok).toBe(true);
    expect(validatePublishPageRequestV1(request).ok).toBe(true);
    expect(request.objectId).toBe(computePageObjectId(page));
    expect(selected.map((item) => item.id)).toEqual(["evidence-1"]);
    expect(page.evidence).toEqual(selected);

    const serialized = JSON.stringify(request);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(serialized).not.toContain(forbidden);
    }

    const topLevelKeys = Object.keys(page).sort();
    expect(topLevelKeys).toEqual(
      [
        "body",
        "evidence",
        "generator",
        "kind",
        "labels",
        "license",
        "provenance",
        "schemaVersion",
        "summary",
        "title",
        "verification",
      ].sort(),
    );

    expect(page.provenance).toMatchObject({
      sourceKind: "session_dossier",
      sourceSchema: "canonical-session-dossier-v1",
    });
    expect(page.provenance).not.toHaveProperty("sessionId");
    expect(page.provenance).not.toHaveProperty("sourceSessionId");
    expect(scanPageEgress(page).decision).toBe("ready");
    expect(scanCompleteOutboundRequest(request).decision).toBe("ready");
  });

  test("confirmed secrets cannot be overridden into a ready outbound request", () => {
    const { page, request } = buildOutbound({
      keyWorkOverride: ["Rotated sk-secret-value-1234567890 in production."],
    });
    const scan = scanCompleteOutboundRequest(request);
    expect(scan.decision).toBe("blocked");
    expect(scan.findings.some((finding) => finding.severity === "block")).toBe(true);
    expect(JSON.stringify(page)).toContain("sk-secret-value-1234567890");
  });

  test("projector never spreads local dossier objects into PageRevisionV1", () => {
    const dossier = completeDossier() as PublishedSessionDossierV1 & { secretLeak: string };
    dossier.secretLeak = "SPREAD_LEAK_MARKER";
    const page = projectSessionDossier({
      dossier,
      license: "all-rights-reserved",
      generatorVersion: "0.1.15",
      evidence: [],
    });
    expect(JSON.stringify(page)).not.toContain("SPREAD_LEAK_MARKER");
    expect(page).not.toHaveProperty("secretLeak");
    expect(page).not.toHaveProperty("identity");
    expect(page).not.toHaveProperty("narrative");
    expect(page).not.toHaveProperty("files");
    expect(page).not.toHaveProperty("tools");
    expect(page).not.toHaveProperty("usage");
  });
});
