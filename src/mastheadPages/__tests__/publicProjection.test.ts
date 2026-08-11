import { describe, expect, test } from "vitest";

import type { EvidenceRef } from "../../core/types.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { validatePageRevisionV1 } from "../contract.ts";
import {
  projectSessionDossier,
  type SessionDossierProjectionInput,
} from "../publicProjection.ts";
import type { EvidenceItemV1, SourceLinkV1 } from "../types.ts";

const narrativeRef: EvidenceRef = {
  id: "msg:1",
  kind: "event",
  observedAt: "2026-08-11T10:00:00.000Z",
  source: "test",
};

const PRIVATE_SESSION_ID = "session:private-alpha-do-not-leak";
const PRIVATE_SOURCE_ID = "source:private-alpha-do-not-leak";
const PRIVATE_REPO_ROOT = "/home/secret/repo-root-path";
const PRIVATE_FIRST_PROMPT = "SECRET_FIRST_USER_PROMPT_VALUE";
const PRIVATE_CAPTURED_AT = "2026-08-11T12:34:56.789Z";

function durableEnrichment(overrides: Record<string, unknown> = {}) {
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
      blockers: ["Evidence selection lands in Local 03"],
      verification: {
        status: "passed" as const,
        summary: "Projection unit tests passed.",
        commands: ["npm test -- --run src/mastheadPages", "npm run typecheck"],
        failures: [],
        evidenceRefs: [narrativeRef],
      },
      continuation: {
        nextStep: "Resolve reviewed evidence",
        openQuestions: ["How should batch review surface findings?"],
        constraints: ["No raw transcripts"],
      },
      evidenceRefs: [narrativeRef],
      warnings: ["Evidence must be publisher-selected"],
      ...((overrides.sessionDossier as object) ?? {}),
    },
    ...overrides,
  };
}

function completeDossier(
  overrides: Partial<PublishedSessionDossierV1> = {},
): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    capturedAt: PRIVATE_CAPTURED_AT,
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
      warnings: [
        {
          code: "verification_missing",
          message: "private coverage warning",
        },
      ],
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
      topics: ["public-alpha", "contracts", "do-not-auto-include"],
      technologies: ["typescript", "vitest"],
      unresolved: ["private unresolved"],
      narrativeDebug: {
        provider: "secret",
        model: "secret",
        sourceRefs: [narrativeRef],
      },
    },
    files: [
      {
        fileEffectId: "file-effect:1",
        path: "/home/secret/repo/src/private.ts",
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
        outputPreview: "SECRET_TOOL_OUTPUT",
        sourceRef: { id: "tool:1" },
      },
    ],
    verification: {
      status: "passed",
      summary: "local verification summary must not auto-map",
      commands: [],
    },
    attention: [
      {
        kind: "blocked",
        severity: "P1",
        title: "private attention",
        sourceRefs: [narrativeRef],
      },
    ],
    excerpts: [
      {
        excerptId: "excerpt:private",
        kind: "message",
        text: "SECRET_EXCERPT_TEXT",
        observedAt: "2026-08-11T10:00:00.000Z",
        sourceRef: { id: "excerpt:1" },
      },
    ],
    timeline: [
      {
        eventId: "timeline:1",
        kind: "user",
        label: "user",
        summary: "private timeline",
        observedAt: "2026-08-11T10:00:00.000Z",
      },
    ],
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
    ...overrides,
  };
}

const reviewedEvidence: EvidenceItemV1[] = [
  {
    id: "evidence-1",
    kind: "excerpt",
    label: "Acceptance note",
    text: "Unknown fields are rejected before object identity is computed.",
    supports: ["decisions", "key-work"],
  },
];

const reviewedSourceLinks: SourceLinkV1[] = [
  {
    rel: "repository",
    label: "masthead",
    url: "https://github.com/MayberryDT/Masthead",
  },
];

function validInput(
  overrides: Partial<SessionDossierProjectionInput> = {},
): SessionDossierProjectionInput {
  return {
    dossier: completeDossier(),
    license: "cc-by-4.0",
    generatorVersion: "0.1.15",
    evidence: reviewedEvidence,
    sourceLinks: reviewedSourceLinks,
    topics: ["public-alpha", "contracts"],
    technologies: ["typescript"],
    includeSourceDate: true,
    ...overrides,
  };
}

describe("projectSessionDossier", () => {
  test("projects durable fields and structurally excludes private dossier sections", () => {
    const input = validInput();
    const page = projectSessionDossier(input);
    const serialized = JSON.stringify(page);

    expect(page.title).toBe(input.dossier.durableEnrichment?.sessionTitle.text);
    expect(page.summary).toBe(
      input.dossier.durableEnrichment?.sessionSummary.text,
    );
    expect(page.body.purpose).toBe(
      input.dossier.durableEnrichment?.sessionDossier.purpose,
    );
    expect(page.body.outcome).toBe(
      input.dossier.durableEnrichment?.sessionDossier.outcome,
    );
    expect(page.body.keyWork).toEqual(
      input.dossier.durableEnrichment?.sessionDossier.keyWork,
    );
    expect(page.body.decisions).toEqual(
      input.dossier.durableEnrichment?.sessionDossier.decisions,
    );
    expect(page.body.blockers).toEqual(
      input.dossier.durableEnrichment?.sessionDossier.blockers,
    );
    expect(page.body.warnings).toEqual(
      input.dossier.durableEnrichment?.sessionDossier.warnings,
    );
    expect(page.body.continuation).toEqual({
      nextStep: "Resolve reviewed evidence",
      openQuestions: ["How should batch review surface findings?"],
      constraints: ["No raw transcripts"],
    });

    expect(serialized).not.toContain(PRIVATE_SESSION_ID);
    expect(serialized).not.toContain(PRIVATE_SOURCE_ID);
    expect(serialized).not.toContain(PRIVATE_REPO_ROOT);
    expect(serialized).not.toContain("repoRoot");
    expect(serialized).not.toContain("firstUserPrompt");
    expect(serialized).not.toContain(PRIVATE_FIRST_PROMPT);
    expect(serialized).not.toContain("capturedAt");
    expect(serialized).not.toContain(PRIVATE_CAPTURED_AT);
    expect(serialized).not.toContain("worktreePath");
    expect(serialized).not.toContain("SECRET_TOOL_OUTPUT");
    expect(serialized).not.toContain("SECRET_EXCERPT_TEXT");
    expect(serialized).not.toContain("SECRET_COPYABLE_CONTEXT");
    expect(serialized).not.toContain("secret-provider");
    expect(serialized).not.toContain("inputTokens");
    expect(serialized).not.toContain("file-effect:1");
    expect(serialized).not.toContain("timeline:1");
  });

  test("never falls back to raw prompts for title or summary", () => {
    const dossier = completeDossier();
    dossier.durableEnrichment = undefined;
    expect(() => projectSessionDossier(validInput({ dossier }))).toThrow(
      /Current durable enrichment is required/,
    );

    const emptyTitle = completeDossier();
    emptyTitle.durableEnrichment = {
      ...durableEnrichment(),
      sessionTitle: {
        text: "   ",
        basis: "fallback",
        confidence: "low",
        evidenceRefs: [narrativeRef],
      },
    };
    expect(() =>
      projectSessionDossier(validInput({ dossier: emptyTitle })),
    ).toThrow(/title_required/);
  });

  test("uses reviewed topic and technology labels only", () => {
    const page = projectSessionDossier(
      validInput({
        topics: ["public-alpha"],
        technologies: ["typescript"],
      }),
    );
    expect(page.labels.topics).toEqual(["public-alpha"]);
    expect(page.labels.technologies).toEqual(["typescript"]);
    expect(JSON.stringify(page)).not.toContain("do-not-auto-include");
    expect(JSON.stringify(page)).not.toContain("vitest");
  });

  test("represents verification fidelity from durable enrichment", () => {
    const page = projectSessionDossier(validInput());
    expect(page.verification).toEqual({
      status: "passed",
      summary: "Projection unit tests passed.",
      checks: ["npm test -- --run src/mastheadPages", "npm run typecheck"],
      failures: [],
    });
  });

  test("includes optional date-only provenance and omits precise timestamps", () => {
    const withDate = projectSessionDossier(
      validInput({ includeSourceDate: true }),
    );
    expect(withDate.provenance.sourceDate).toBe("2026-08-11");
    expect(JSON.stringify(withDate.provenance)).not.toMatch(
      /T\d{2}:\d{2}:\d{2}/,
    );

    const withoutDate = projectSessionDossier(
      validInput({ includeSourceDate: false }),
    );
    expect(withoutDate.provenance.sourceDate).toBeUndefined();
    expect(Object.keys(withoutDate.provenance).sort()).toEqual([
      "sourceKind",
      "sourceLinks",
      "sourceSchema",
    ]);
  });

  test("validates source links as HTTPS without credentials", () => {
    expect(() =>
      projectSessionDossier(
        validInput({
          sourceLinks: [
            {
              rel: "repository",
              label: "bad",
              url: "http://github.com/MayberryDT/Masthead",
            },
          ],
        }),
      ),
    ).toThrow(/must use https/);

    expect(() =>
      projectSessionDossier(
        validInput({
          sourceLinks: [
            {
              rel: "repository",
              label: "creds",
              url: "https://user:pass@github.com/MayberryDT/Masthead",
            },
          ],
        }),
      ),
    ).toThrow(/must not include credentials/);
  });

  test("omits empty optional body fields rather than serializing null", () => {
    const dossier = completeDossier();
    dossier.durableEnrichment = {
      ...durableEnrichment(),
      sessionDossier: {
        ...durableEnrichment().sessionDossier,
        purpose: undefined,
        outcome: undefined,
        blockers: [],
        warnings: [],
        continuation: {
          nextStep: undefined,
          openQuestions: [],
          constraints: [],
        },
        keyWork: ["only work"],
        decisions: [],
        verification: {
          status: "missing",
          summary: "No verification recorded.",
          commands: [],
          failures: [],
          evidenceRefs: [narrativeRef],
        },
        evidenceRefs: [narrativeRef],
      },
    };

    const page = projectSessionDossier(
      validInput({
        dossier,
        evidence: [],
        sourceLinks: [],
        topics: [],
        technologies: [],
        includeSourceDate: false,
      }),
    );

    expect(page.body).not.toHaveProperty("purpose");
    expect(page.body).not.toHaveProperty("outcome");
    expect(page.body.continuation).not.toHaveProperty("nextStep");
    expect(page.body.keyWork).toEqual(["only work"]);
    expect(page.body.decisions).toEqual([]);
    expect(page.evidence).toEqual([]);
    expect(page.provenance.sourceLinks).toEqual([]);

    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain('"purpose"');
    expect(serialized).not.toContain('"outcome"');
    expect(serialized).not.toContain("null");
  });

  test("records installed generator version and projection id", () => {
    const page = projectSessionDossier(
      validInput({ generatorVersion: "0.1.15" }),
    );
    expect(page.generator).toEqual({
      name: "Masthead",
      version: "0.1.15",
      projection: "session-dossier-public-v1",
    });
    expect(page.schemaVersion).toBe("masthead-page-revision-v1");
    expect(page.kind).toBe("session_dossier");
    expect(page.license).toBe("cc-by-4.0");
  });

  test("uses only reviewed evidence with release-local ids", () => {
    const page = projectSessionDossier(validInput());
    expect(page.evidence).toEqual(reviewedEvidence);
    expect(JSON.stringify(page)).not.toContain("excerpt:private");
    expect(JSON.stringify(page)).not.toContain("SECRET_EXCERPT_TEXT");
  });

  test("snapshot lists exact portable top-level keys", () => {
    const page = projectSessionDossier(validInput());
    expect(Object.keys(page).sort()).toMatchInlineSnapshot(`
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
      ]
    `);
  });

  test("output validates against the imported PageRevisionV1 contract", () => {
    const page = projectSessionDossier(validInput());
    const result = validatePageRevisionV1(page);
    expect(result).toMatchObject({ ok: true });
  });
});
