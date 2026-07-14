import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import {
  REHEARSAL_PORT,
  assertDiscoveryCompletion,
  buildIsolatedDaemonEnv,
  classifyPreparedInvalidationState,
  evaluateCandidateLabels,
  isExplicitlyUnknown,
  normalizedDossierForComparison,
  normalizedOriginalDossierForComparison,
  selectCanaryCandidates,
  validateDaemonCloseResult,
  validateHumanReviewReceipt,
  validateStaticRehearsalConfig
} from "../../../scripts/durable-artifact-rehearsal.js";

const SHA = "a".repeat(64);
const BUILD_SHA = "b".repeat(40);

function config(overrides: Record<string, unknown> = {}) {
  const root = join(tmpdir(), "masthead-durable-rehearsal-test");
  return {
    bundleRoot: "/opt/Masthead-linux-x64-bbbbbbbb",
    expectedAuditHash: SHA,
    expectedBuildSha: BUILD_SHA,
    expectedDatabaseId: "database:test",
    expectedLabelSha256: SHA,
    expectedSampleSha256: SHA,
    expectedSourceSha256: SHA,
    labelsPath: "/repo/labels.json",
    port: REHEARSAL_PORT,
    root,
    samplePath: "/repo/sample.json",
    sourceBackup: "/home/test/.config/masthead-production/masthead.sqlite.backup-current",
    ...overrides
  };
}

describe("durable artifact temporary-copy rehearsal coordinator", () => {
  test("pins every writable path beneath a dedicated temporary root", () => {
    const validated = validateStaticRehearsalConfig(config());

    expect(validated).toMatchObject({
      activeDatabase: join(validated.root, "masthead.sqlite"),
      recoveryBackup: join(validated.root, "masthead.sqlite.backup-current"),
      frozenDatabase: join(validated.root, "frozen-v1", "masthead.sqlite"),
      port: 17483
    });
    expect(validated.daemonEntry).toBe(
      "/opt/Masthead-linux-x64-bbbbbbbb/resources/daemon/dist/src/daemon/main.js"
    );
    expect(validated.dossierEntry).toBe(
      "/opt/Masthead-linux-x64-bbbbbbbb/resources/daemon/dist/src/daemon/db/sessionDossierRepository.js"
    );
  });

  test.each([
    [{ root: "/home/test/rehearsal" }, "temporary directory"],
    [{ root: tmpdir() }, "dedicated temporary root"],
    [{ root: join(tmpdir(), "parent", "masthead-durable-rehearsal-test") }, "direct child"],
    [{ root: join(tmpdir(), "ordinary-folder") }, "masthead-durable-rehearsal-"],
    [{ port: 17383 }, "port 17483"],
    [{ sourceBackup: "/tmp/masthead.sqlite" }, "masthead.sqlite.backup-current"],
    [{ sourceBackup: join(tmpdir(), "masthead-durable-rehearsal-test", "source", "masthead.sqlite.backup-current") }, "outside the rehearsal root"],
    [{ expectedAuditHash: "short" }, "expectedAuditHash"],
    [{ expectedBuildSha: "development" }, "expectedBuildSha"]
  ])("refuses unsafe static configuration %#", (overrides, message) => {
    expect(() => validateStaticRehearsalConfig(config(overrides))).toThrow(message);
  });

  test("disables every background or remote daemon writer and binds the isolated identity", () => {
    const validated = validateStaticRehearsalConfig(config());
    const env = buildIsolatedDaemonEnv(validated, "/tmp/masthead-durable-rehearsal-test/bin/mastheadctl");

    expect(env).toMatchObject({
      MASTHEAD_BACKGROUND_HYDRATION: "0",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
      MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0",
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "0",
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_DB_PATH: validated.activeDatabase,
      MASTHEAD_DATA_DIR: validated.root,
      MASTHEAD_PORT: "17483",
      MASTHEAD_BUILD_SHA: BUILD_SHA
    });
    expect(env.OPENAI_API_KEY).toBe("");
  });

  test("maps frozen labels against candidate provenance without candidate-defined ground truth", () => {
    const labels = [
      label("session:one", "runbook", true),
      label("session:one", "adr", false),
      label("session:two", "runbook", true),
      label("session:two", "incident_timeline", false)
    ];
    const candidates = [
      candidate("candidate:joined", "runbook", ["session:one", "session:two"]),
      candidate("candidate:false-positive", "incident_timeline", ["session:two"])
    ];

    expect(evaluateCandidateLabels(labels, candidates)).toMatchObject({
      falseNegative: 0,
      falsePositive: 1,
      precision: 2 / 3,
      recall: 1,
      total: 4,
      trueNegative: 1,
      truePositive: 2
    });
    expect(selectCanaryCandidates(candidates, new Set(["session:one"])).map((entry) => entry.candidateId))
      .toEqual(["candidate:joined"]);
  });

  test("requires all 1,283 current source revisions to have detector-revision scans", () => {
    expect(() => assertDiscoveryCompletion({ eligibleSessions: 1_283, currentScans: 1_282 }, 1_283))
      .toThrow("candidate discovery incomplete");
    expect(assertDiscoveryCompletion({ eligibleSessions: 1_283, currentScans: 1_283 }, 1_283))
      .toEqual({ eligibleSessions: 1_283, currentScans: 1_283 });
  });

  test("resumes prepared invalidation only from the exact ready or atomically committed population", () => {
    const baseline = {
      artifacts: 1_283,
      candidates: 0,
      provenance: 1_283,
      runs: 66,
      searchRows: 1_283,
      sessions: 1_283
    };
    expect(classifyPreparedInvalidationState(baseline)).toBe("ready");
    expect(classifyPreparedInvalidationState({
      ...baseline,
      artifacts: 0,
      provenance: 0,
      searchRows: 0
    })).toBe("committed");
    expect(() => classifyPreparedInvalidationState({ ...baseline, artifacts: 1_282 }))
      .toThrow("neither the exact V1 baseline nor the exact committed invalidation");
  });

  test("accepts only a requested zero-exit daemon shutdown", () => {
    expect(validateDaemonCloseResult({ code: 0, signal: null }, true)).toEqual({ code: 0, signal: null });
    expect(() => validateDaemonCloseResult({ code: 0, signal: null }, false))
      .toThrow("exited before coordinator shutdown");
    expect(() => validateDaemonCloseResult({ code: 1, signal: null }, true))
      .toThrow("shutdown failed");
    expect(() => validateDaemonCloseResult({ code: null, signal: "SIGTERM" }, true))
      .toThrow("shutdown failed");
  });

  test("requires a human receipt covering every dossier and optional artifact", () => {
    const receipt = {
      receiptVersion: 1,
      reviewerKind: "human",
      reviewer: "Tyler",
      signedAt: "2026-07-14T12:00:00.000Z",
      machineReportSha256: SHA,
      packetSha256: SHA,
      reviewSetSha256: SHA,
      dossiers: [review("dossier:1", [5, 5, 4, 4, 5])],
      optionalArtifacts: [review("artifact:1", [4, 4, 4, 4, 4])]
    };
    const expected = {
      dossierArtifactIds: ["dossier:1"],
      machineReportSha256: SHA,
      optionalArtifactIds: ["artifact:1"],
      packetSha256: SHA,
      reviewSetSha256: SHA
    };

    expect(validateHumanReviewReceipt(receipt, expected)).toMatchObject({ medianOverall: 4.3, minimumOverall: 4 });

    expect(() => validateHumanReviewReceipt(
      { ...receipt, reviewerKind: "agent" },
      expected
    )).toThrow("real human");
    expect(() => validateHumanReviewReceipt(
      { ...receipt, optionalArtifacts: [] },
      expected
    )).toThrow("review coverage mismatch");
    expect(() => validateHumanReviewReceipt(
      { ...receipt, dossiers: [review("dossier:1", [3, 5, 4, 4, 5])] },
      expected
    )).toThrow("findability note");
    expect(() => validateHumanReviewReceipt(
      { ...receipt, dossiers: [review("dossier:1", [5, 5, 4, 4, 5]), review("dossier:1", [5, 5, 4, 4, 5])] },
      expected
    )).toThrow("duplicates");
    expect(() => validateHumanReviewReceipt(
      { ...receipt, packetSha256: "b".repeat(64) },
      expected
    )).toThrow("packet binding");
  });

  test("uses the production unknown-root-cause contract", () => {
    expect(isExplicitlyUnknown("The root cause remains unknown from the available evidence.")).toBe(true);
    expect(isExplicitlyUnknown("Available canonical evidence cannot determine the root cause.")).toBe(true);
    expect(isExplicitlyUnknown("The root cause was a stale cache key.")).toBe(false);
  });

  test("dossier comparison keeps every reuse field while omitting only publication wrappers", () => {
    const normalized = normalizedDossierForComparison({
      artifacts: [{ artifactId: "recursive" }],
      capturedAt: "2026-07-14T12:00:00.000Z",
      identity: { title: "Useful session" },
      reuse: { copyableContext: "human context", mcpIncluded: true },
      snapshotVersion: "canonical-session-dossier-v1"
    });

    expect(normalized).toEqual({
      identity: { title: "Useful session" },
      reuse: { copyableContext: "human context", mcpIncluded: true }
    });
  });

  test("historical dossier comparison neutralizes only the publication state for a previously unpublished session", () => {
    const before = {
      identity: { title: "Useful session" },
      reuse: {
        canonicalSessionId: "session:one",
        copyableContext: "# Masthead Session Context\nSummary: durable human context\nAgent retrieval: excluded",
        mcpIncluded: false,
        sourceConfidence: "high",
        sourceRuntime: "codex",
        sourceSessionId: "source:one"
      }
    };
    const after = structuredClone(before);
    after.reuse.copyableContext = "# Masthead Session Context\nSummary: durable human context\nAgent retrieval: included";
    after.reuse.mcpIncluded = true;

    expect(normalizedOriginalDossierForComparison(before, false))
      .toEqual(normalizedOriginalDossierForComparison(after, false));
    expect(normalizedOriginalDossierForComparison(before, true))
      .not.toEqual(normalizedOriginalDossierForComparison(after, true));

    const changedHumanContext = structuredClone(after);
    changedHumanContext.reuse.copyableContext =
      "# Masthead Session Context\nSummary: different human context\nAgent retrieval: included";
    expect(normalizedOriginalDossierForComparison(before, false))
      .not.toEqual(normalizedOriginalDossierForComparison(changedHumanContext, false));

    const missingTerminalState = structuredClone(before);
    missingTerminalState.reuse.copyableContext = "# Masthead Session Context\nSummary: durable human context";
    expect(() => normalizedOriginalDossierForComparison(missingTerminalState, false))
      .toThrow("no terminal Agent retrieval state");
  });
});

function label(sessionId: string, kind: string, expectedCandidate: boolean) {
  return { sessionId, kind, expectedCandidate };
}

function candidate(candidateId: string, kind: string, provenanceSessionIds: string[]) {
  return { candidateId, kind, provenanceSessionIds };
}

function review(artifactId: string, scores: number[]) {
  const [findability, grounding, reusability, specificity, readability] = scores;
  return {
    artifactId,
    scores: { findability, grounding, reusability, specificity, readability }
  };
}
