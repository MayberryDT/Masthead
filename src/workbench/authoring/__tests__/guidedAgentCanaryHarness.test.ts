import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../../daemon/db/sqlite.ts";
import * as guidedCanary from "../../../../scripts/masthead-guided-agent-canary.js";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import {
  assertIsolatedGuidedCanaryRuntime,
  buildGuidedAgentLaunchPackage,
  guidedAgentCanaryFailures,
  runGuidedAgentCanary
} from "../../../../scripts/masthead-guided-agent-canary.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("guided fresh-agent canary harness", () => {
  test("launch package contains one opaque request and one instance-bound start command only", () => {
    const instanceDirectory = "/tmp/masthead-guided-canary/instance";
    const requestId = "request:opaque-one";
    const launchPackage = buildGuidedAgentLaunchPackage({
      requestId,
      startCommand: `${instanceDirectory}/bin/mastheadctl workbench author start --request ${requestId} --json`,
      instanceDirectory,
      forbiddenValues: ["session:fixture:one", "known fixture answer"]
    });
    expect(launchPackage).toEqual({
      schemaVersion: "masthead-guided-agent-launch-v1",
      requestId,
      startCommand: `${instanceDirectory}/bin/mastheadctl workbench author start --request ${requestId} --json`
    });
    expect(new Set(JSON.stringify(launchPackage).match(/request:opaque-one/gu))).toEqual(new Set([requestId]));
    expect(JSON.stringify(launchPackage)).not.toContain("session:fixture:one");
    expect(JSON.stringify(launchPackage)).not.toContain("known fixture answer");
    expect(JSON.stringify(launchPackage)).not.toContain("sessionIds");
    expect(JSON.stringify(launchPackage)).not.toContain("draft");
  });

  test("rejects fixture context leaks and commands outside the isolated instance", () => {
    const instanceDirectory = "/tmp/masthead-guided-canary/instance";
    expect(() => buildGuidedAgentLaunchPackage({
      requestId: "request:one",
      startCommand: "/usr/local/bin/mastheadctl workbench author start --request request:one --json",
      instanceDirectory
    })).toThrow("guided_canary_start_command_not_instance_bound");
    expect(() => buildGuidedAgentLaunchPackage({
      requestId: "request:one",
      startCommand: `${instanceDirectory}/bin/mastheadctl workbench author start --request request:one --json --note fixture-answer`,
      instanceDirectory,
      forbiddenValues: ["fixture-answer"]
    })).toThrow("guided_canary_launch_package_leaked_fixture_context");
  });

  test.each([
    ["database", "/safe/manifest.json", "/home/test/.local/share/masthead-production/masthead.sqlite", "guided_canary_refuses_live_production_database"],
    ["manifest", "/home/test/.config/masthead-production/masthead-instance.json", "/safe/masthead.sqlite", "guided_canary_refuses_live_production_manifest"]
  ])("refuses the live production %s", (_label, manifestPath, databasePath, expected) => {
    expect(() => assertIsolatedGuidedCanaryRuntime({
      baseUrl: "http://127.0.0.1:28111",
      databasePath,
      homeDir: "/home/test",
      manifestPath,
      port: 28111
    })).toThrow(expected);
  });

  test.each([5173, 17_373, 17_383])("refuses reserved production/runtime port %s", (port) => {
    expect(() => assertIsolatedGuidedCanaryRuntime({
      baseUrl: `http://127.0.0.1:${port}`,
      databasePath: "/tmp/canary/masthead.sqlite",
      manifestPath: "/tmp/canary/masthead-instance.json",
      port
    })).toThrow("guided_canary_requires_non_production_port");
  });

  test("cannot pass a lying all-green agent report over trusted verifier evidence", () => {
    const lyingAgentReport = passingAgentReport();
    const trustedReport = {
      ...lyingAgentReport,
      completeEvidenceCoverage: 0.5,
      acceptedArtifactIds: [],
      artifactOnlyReusePassRate: 0,
      harnessSuppliedAuthoredContent: false,
      humanReview: { independentReusePassed: false, signed: false, specificityPassed: false }
    };
    expect(guidedAgentCanaryFailures(trustedReport, lyingAgentReport)).toEqual(expect.arrayContaining([
      "complete_evidence_coverage_below_1",
      "accepted_artifacts_missing",
      "artifact_only_reuse_below_1",
      "human_review_not_signed"
    ]));
  });

  test("binds a post-run human review to this request, accepted artifacts, and trusted report hash", () => {
    expect(typeof guidedCanary.buildGuidedHumanReviewChallenge).toBe("function");
    const report = {
      ...passingAgentReport(),
      acceptedArtifactIds: ["artifact:z", "artifact:a"],
      failedV3TemplateRejected: true,
      fixtureSessionCount: 9,
      opportunityDispositionCoverage: 1,
      optionalClaimSupportCoverage: 1,
      sessionClaimSupportCoverage: 1
    };
    const challenge = guidedCanary.buildGuidedHumanReviewChallenge("request:current", report);
    expect(challenge).toMatchObject({
      requestId: "request:current",
      acceptedArtifactIds: ["artifact:a", "artifact:z"],
      schemaVersion: "masthead-guided-human-review-v1",
      reviewRequestedAt: expect.any(String),
      trustedReportHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      reviewBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    const signed = {
      ...challenge,
      signed: true,
      specificityPassed: true,
      independentReusePassed: true,
      signedAt: new Date(Date.now() + 1_000).toISOString(),
      signedBy: "tyler"
    };
    expect(guidedCanary.trustedHumanReview(signed, challenge)).toMatchObject({ signed: true });
    expect(guidedCanary.trustedHumanReview({ ...signed, requestId: "request:stale" }, challenge))
      .toMatchObject({ signed: false });
    expect(guidedCanary.trustedHumanReview({ ...signed, signedAt: "2000-01-01T00:00:00.000Z" }, challenge))
      .toMatchObject({ signed: false });
    expect(typeof guidedCanary.verifyPersistedGuidedAgentReview).toBe("function");
    const persisted = {
      reportVersion: "guided-agent-canary-v1",
      launchPackage: { requestId: "request:current" },
      report: { ...report, humanReviewChallenge: challenge, humanReview: { signed: false } },
      failures: ["human_review_not_signed"],
      passed: false,
      productionAccessed: false
    };
    expect(guidedCanary.verifyPersistedGuidedAgentReview(persisted, signed)).toMatchObject({ passed: true, failures: [] });
    expect(guidedCanary.verifyPersistedGuidedAgentReview(persisted, { ...signed, trustedReportHash: "0".repeat(64) }))
      .toMatchObject({ passed: false, failures: expect.arrayContaining(["human_review_not_signed"]) });
  });

  test("gives the fresh agent a minimal isolated environment", () => {
    expect(typeof guidedCanary.buildFreshAgentEnvironment).toBe("function");
    const environment = guidedCanary.buildFreshAgentEnvironment({
      HOME: "/home/operator",
      LANG: "en_US.UTF-8",
      MASTHEAD_DB_PATH: "/home/operator/.config/masthead-production/masthead.sqlite",
      OPENAI_API_KEY: "test-key",
      PATH: "/usr/bin",
      SECRET_THAT_MUST_NOT_LEAK: "secret"
    }, {
      agentHome: "/tmp/canary/agent-home",
      codexHome: "/tmp/canary/codex-home",
      launchPackage: { requestId: "request:one", schemaVersion: "masthead-guided-agent-launch-v1", startCommand: "/tmp/instance/mastheadctl start" }
    });
    expect(environment).toMatchObject({
      CODEX_HOME: "/tmp/canary/codex-home",
      HOME: "/tmp/canary/agent-home",
      LANG: "en_US.UTF-8",
      MASTHEAD_GUIDED_LAUNCH_PACKAGE: expect.any(String),
      OPENAI_API_KEY: "test-key",
      PATH: "/usr/bin"
    });
    expect(environment).not.toHaveProperty("MASTHEAD_DB_PATH");
    expect(environment).not.toHaveProperty("MASTHEAD_DAEMON_URL");
    expect(environment).not.toHaveProperty("MASTHEAD_INSTANCE_MANIFEST");
    expect(environment).not.toHaveProperty("SECRET_THAT_MUST_NOT_LEAK");
  });

  test("persists the unsigned review packet outside the disposable workspace with mode 0600", async () => {
    expect(typeof guidedCanary.persistGuidedAgentReport).toBe("function");
    const directory = await mkdtemp(join(tmpdir(), "masthead-guided-report-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "unsigned-report.json");
    await guidedCanary.persistGuidedAgentReport(path, { reportVersion: "guided-agent-canary-v1", passed: false });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ reportVersion: "guided-agent-canary-v1", passed: false });
    await expect(guidedCanary.persistGuidedAgentReport(path, {})).rejects.toMatchObject({ code: "EEXIST" });
  });

  test("derives out-of-band use from an audited CLI sequence instead of trusting the agent", () => {
    expect(typeof guidedCanary.auditFreshAgentOperations).toBe("function");
    const expected = {
      assignmentCount: 1,
      assignmentIds: ["assignment:one"],
      draftRevisionCount: 2,
      evidenceSessionCount: 1,
      requestId: "request:one",
      sessionIds: ["session:one"]
    };
    const allowed = [
      ["workbench", "author", "start", "--request", "request:one", "--json"],
      ["workbench", "author", "inspect", "--assignment", "assignment:one", "--session", "session:one", "--cursor", "0", "--json"],
      ["workbench", "author", "scaffold", "--assignment", "assignment:one", "--file", "/tmp/scaffold.json", "--json"],
      ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/draft.json", "--json"],
      ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/revised.json", "--json"],
      ["workbench", "author", "review", "--assignment", "assignment:one", "--json"],
      ["workbench", "author", "finish", "--assignment", "assignment:one", "--json"]
    ];
    expect(guidedCanary.auditFreshAgentOperations(allowed, expected)).toMatchObject({
      outOfBandSessionListRequired: false,
      saveAttempts: { attempted: 2, failed: 0, repairLimit: 8, successful: 2 }
    });
    const repaired = [
      ...allowed.slice(0, 3).map((argv) => ({ argv, status: 0 })),
      { argv: ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/draft.json", "--json"], status: 1 },
      ...allowed.slice(3).map((argv) => ({ argv, status: 0 }))
    ];
    expect(guidedCanary.auditFreshAgentOperations(repaired, expected)).toMatchObject({
      invalidOperationCount: 0,
      outOfBandSessionListRequired: false,
      saveAttempts: { attempted: 3, failed: 1, repairLimit: 8, successful: 2 }
    });
    expect(guidedCanary.auditFreshAgentOperations([...allowed, ["workbench", "author", "status", "--request", "request:one"]], expected))
      .toMatchObject({ outOfBandSessionListRequired: true });
    expect(guidedCanary.auditFreshAgentOperations(allowed.map((argv, index) => ({ argv, status: index === 1 ? 1 : 0 })), expected))
      .toMatchObject({ outOfBandSessionListRequired: true });
    expect(guidedCanary.auditFreshAgentOperations(
      allowed.map((argv, index) => ({ argv, status: index === 3 ? null : 0 })), expected
    )).toMatchObject({ outOfBandSessionListRequired: true });
    for (const invalidRepair of [
      { argv: ["workbench", "author", "save", "--assignment", "assignment:foreign", "--file", "/tmp/draft.json", "--json"], status: 1 },
      { argv: ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/not-retried.json", "--json"], status: 1 },
      { argv: ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/draft.json", "--json"], status: 2 }
    ]) {
      expect(guidedCanary.auditFreshAgentOperations([
        invalidRepair,
        ...allowed.map((argv) => ({ argv, status: 0 }))
      ], expected)).toMatchObject({ invalidOperationCount: 1, outOfBandSessionListRequired: true });
    }
    expect(guidedCanary.auditFreshAgentOperations([
      ...Array.from({ length: 9 }, () => ({
        argv: ["workbench", "author", "save", "--assignment", "assignment:one", "--file", "/tmp/draft.json", "--json"],
        status: 1
      })),
      ...allowed.map((argv) => ({ argv, status: 0 }))
    ], expected)).toMatchObject({
      invalidOperationCount: 1,
      outOfBandSessionListRequired: true,
      saveAttempts: { attempted: 11, failed: 9, repairLimit: 8, successful: 2 }
    });
    expect(guidedCanary.auditFreshAgentOperations([], expected)).toMatchObject({ outOfBandSessionListRequired: true });
  });

  test("artifact-only reuse requires fixture-specific content, not a structurally nonempty dossier", () => {
    expect(typeof guidedCanary.buildArtifactOnlyReuseTask).toBe("function");
    const capsule = { artifactId: "artifact:one", kind: "session_dossier", title: "Generic session" };
    const generic = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Generic session" }, sessionSummary: { text: "Work was done." }, sessionDossier: { keyWork: ["Changed things"], verification: { summary: "Looks fine" } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(generic.passed).toBe(false);
    const resultHiddenOutsideSummary = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "Verification not run." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce"], verification: { summary: "No verification was captured." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(resultHiddenOutsideSummary).toMatchObject({
      passed: false,
      expectedAssertions: expect.arrayContaining([
        expect.objectContaining({ code: "capsule_summary_fixture_specific_result", matched: [], required: true })
      ])
    });
    const specific = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "Repaired the stale OAuth nonce after callback validation failed; verification passed." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce"], verification: { summary: "Verification passed after callback validation failed." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(specific).toMatchObject({ passed: true, expectedAssertions: expect.any(Array), derivedAnswer: expect.any(String) });

    const structuredPassedBoundary = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "The stale OAuth nonce was replaced after callback validation failed." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce"], verification: { status: "passed", summary: "The replacement nonce was accepted once and replay was rejected." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(structuredPassedBoundary).toMatchObject({
      passed: true,
      expectedAssertions: expect.arrayContaining([
        expect.objectContaining({ code: "verification_boundary", matched: true })
      ])
    });
    expect(structuredPassedBoundary.derivedAnswer).toContain("Verification: passed.");

    const structuredMixedBoundary = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "The stale OAuth nonce was repaired after callback validation failed." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce"], verification: { status: "mixed", summary: "The replacement nonce was accepted, but replay coverage remained incomplete." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(structuredMixedBoundary).toMatchObject({
      passed: true,
      expectedAssertions: expect.arrayContaining([
        expect.objectContaining({ code: "verification_boundary", matched: true })
      ])
    });
    expect(structuredMixedBoundary.derivedAnswer).toContain("Verification: mixed.");

    const unrelatedFailureWithoutBoundary = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "Repaired the stale OAuth nonce after callback validation failed." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce after callback validation failed."], verification: { summary: "The callback behavior was inspected." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(unrelatedFailureWithoutBoundary).toMatchObject({
      passed: false,
      expectedAssertions: expect.arrayContaining([
        expect.objectContaining({ code: "verification_boundary", matched: false })
      ])
    });

    const honestlyUnverified = guidedCanary.buildArtifactOnlyReuseTask({
      body: { durableEnrichment: { sessionTitle: { text: "Repair stale OAuth nonce" }, sessionSummary: { text: "Repaired the stale OAuth nonce after callback validation failed; verification was not run." }, sessionDossier: { outcome: "Repaired the stale OAuth nonce", keyWork: ["Repaired the stale OAuth nonce"], verification: { summary: "No verification was captured." } } } },
      capsule,
      provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"]
    });
    expect(honestlyUnverified).toMatchObject({
      passed: true,
      expectedAssertions: expect.arrayContaining([
        expect.objectContaining({ code: "verification_boundary", matched: true })
      ])
    });
  });

  test("seeds authorable evidence for every optional kind and a genuinely tool-heavy session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-guided-fixture-signals-"));
    temporaryDirectories.push(directory);
    const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
    migrateDatabase(db);
    const sessionIds = guidedCanary.GUIDED_AGENT_FIXTURE.map(
      ({ key }: { key: string }) => `session:guided-canary:${key}`
    );

    guidedCanary.seedGuidedCanaryFixtureRows(db, sessionIds);

    const candidates = discoverArtifactCandidates(db, sessionIds);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "runbook", provenanceSessionIds: ["session:guided-canary:artifact-signal-runbook"] }),
      expect.objectContaining({ kind: "adr", provenanceSessionIds: ["session:guided-canary:artifact-signal-adr"] }),
      expect.objectContaining({ kind: "incident_timeline", provenanceSessionIds: ["session:guided-canary:artifact-signal-incident"] })
    ]));
    expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls WHERE session_id = ?")
      .get("session:guided-canary:tool-heavy")).toEqual({ count: 50 });
    expect(db.prepare("SELECT checkpoint_kind AS checkpointKind FROM checkpoints WHERE checkpoint_id = ?")
      .get("writer-lease:recovered")).toEqual({ checkpointKind: "incident_restored" });
    db.close();
  });

  test("cannot pass with zero optional artifacts or zero knowledge opportunities", () => {
    const report = {
      ...passingAgentReport(),
      acceptedArtifactKindCounts: { adr: 0, incident_timeline: 0, runbook: 0, session_dossier: 9 },
      opportunityKindCounts: { adr: 0, incident_timeline: 0, runbook: 0 },
      optionalArtifactOnlyReusePassRate: 0
    };

    expect(guidedAgentCanaryFailures(report)).toEqual(expect.arrayContaining([
      "required_runbook_missing",
      "required_adr_missing",
      "required_incident_timeline_missing",
      "required_runbook_opportunity_missing",
      "required_adr_opportunity_missing",
      "required_incident_timeline_opportunity_missing",
      "optional_artifact_reuse_below_1"
    ]));
  });

  test.each([
    ["runbook", {
      fixSteps: ["Clear the stale nonce in auth/callback.ts, bind its replacement to the pending authorization request, then retry callback validation."],
      validationChecks: ["The OAuth callback regression test passed after the nonce repair."]
    }],
    ["adr", {
      alternatives: ["Make a hosted database the canonical session store."],
      consequences: ["A hosted canonical store would break offline operation."],
      decision: "Keep canonical session data in local SQLite."
    }],
    ["incident_timeline", {
      rootCause: "A stale writer lease remained owned by the prior daemon process after its unclean exit.",
      timeline: [
        { summary: "Workbench publishing could not acquire the writer lease." },
        { summary: "Validated the stale owner, cleared the lease, and restarted the daemon." },
        { summary: "Database integrity passed and a canary draft published once." }
      ]
    }]
  ] as const)("requires semantic artifact-only reuse facts for %s", (kind, body) => {
    expect(typeof guidedCanary.buildOptionalArtifactOnlyReuseTask).toBe("function");
    expect(guidedCanary.buildOptionalArtifactOnlyReuseTask({
      body,
      capsule: { artifactId: `artifact:${kind}`, kind }
    })).toMatchObject({ kind, passed: true });
    expect(guidedCanary.buildOptionalArtifactOnlyReuseTask({
      body: { title: "Generic artifact" },
      capsule: { artifactId: `artifact:generic:${kind}`, kind }
    })).toMatchObject({ kind, passed: false });
  });

  test("rejects an OAuth runbook that drops the pending-request binding step", () => {
    expect(guidedCanary.buildOptionalArtifactOnlyReuseTask({
      body: { fixSteps: ["Clear the stale nonce in auth/callback.ts before retrying callback validation."] },
      capsule: { artifactId: "artifact:runbook:lossy", kind: "runbook" }
    })).toMatchObject({
      kind: "runbook",
      passed: false,
      expectedAssertions: expect.arrayContaining([
        { code: "oauth_pending_request_binding", matched: false }
      ])
    });
  });

  test("identity-mismatch snapshots detect writes to any guided table even without revision movement", () => {
    expect(typeof guidedCanary.snapshotGuidedAuthoringState).toBe("function");
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE guided_authoring_requests(request_id TEXT); CREATE TABLE guided_authoring_evidence_access(evidence_ref TEXT); CREATE TABLE data_revisions(scope TEXT, revision INTEGER);");
    db.prepare("INSERT INTO guided_authoring_requests VALUES (?)").run("request:one");
    db.prepare("INSERT INTO data_revisions VALUES (?, ?)").run("workbench", 1);
    const before = guidedCanary.snapshotGuidedAuthoringState(db);
    db.prepare("INSERT INTO guided_authoring_evidence_access VALUES (?)").run("evidence:unexpected");
    const after = guidedCanary.snapshotGuidedAuthoringState(db);
    expect(after.hash).not.toBe(before.hash);
    expect(after.tables).toHaveProperty("guided_authoring_evidence_access");
    db.close();
  });

  test("requires a persisted approval and counts only publication strictly before approval", () => {
    expect(typeof guidedCanary.countCanaryPublicationsBeforeApproval).toBe("function");
    const approval = { decision: "approved", reviewedAt: "2026-07-20T12:00:00.000Z" };
    expect(guidedCanary.countCanaryPublicationsBeforeApproval(["2026-07-20T11:59:59.999Z"], approval)).toBe(1);
    expect(guidedCanary.countCanaryPublicationsBeforeApproval(["2026-07-20T12:00:00.000Z"], approval)).toBe(0);
    expect(() => guidedCanary.countCanaryPublicationsBeforeApproval(["2026-07-20T12:00:00.001Z"], undefined))
      .toThrow("trusted_canary_approval_missing");
  });

  test("kills a fresh agent that exceeds the hard timeout", async () => {
    expect(typeof guidedCanary.runFreshAgentProcess).toBe("function");
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: string | null;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn((signal: string) => {
      child.signalCode = signal;
      queueMicrotask(() => child.emit("exit", null, signal));
      return true;
    });
    await expect(guidedCanary.runFreshAgentProcess({
      agentCommand: "/tmp/fresh-agent",
      agentWorkspace: "/tmp/agent-workspace",
      agentHome: "/tmp/agent-home",
      codexHome: "/tmp/codex-home",
      launchPackage: { requestId: "request:one", schemaVersion: "masthead-guided-agent-launch-v1", startCommand: "/tmp/instance/mastheadctl start" },
      agentTimeoutMs: 5
    }, {
      approveCanary: async () => new Promise(() => undefined),
      spawnProcess: () => child
    })).rejects.toThrow("fresh_agent_timeout");
    expect(child.kill).toHaveBeenCalled();
  });

  test("keeps canary approval alive for the full slow-agent timeout", async () => {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    let approvalTimeout = 0;
    const resultPromise = guidedCanary.runFreshAgentProcess({
      agentCommand: "/tmp/fresh-agent", agentWorkspace: "/tmp/agent", agentHome: "/tmp/home", codexHome: "/tmp/codex",
      baseUrl: "http://127.0.0.1:28111", agentTimeoutMs: 80,
      launchPackage: { requestId: "request:slow", schemaVersion: "masthead-guided-agent-launch-v1", startCommand: "/tmp/instance/mastheadctl start" }
    }, {
      approveCanary: async (_baseUrl: string, _requestId: string, _child: unknown, timeoutMs: number) => {
        approvalTimeout = timeoutMs;
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
      spawnProcess: () => child
    });
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from('{"completed":true}'));
      child.exitCode = 0;
      child.emit("exit", 0, null);
    }, 40);
    await expect(resultPromise).resolves.toEqual({ completed: true });
    expect(approvalTimeout).toBeGreaterThanOrEqual(80);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test.each(["startup", "agent", "gate"] as const)(
    "terminates the child and removes all temporary state after injected %s failure",
    async (failurePoint) => {
      const workspace = await mkdtemp(join(tmpdir(), `masthead-canary-cleanup-${failurePoint}-`));
      temporaryDirectories.push(workspace);
      const terminateChild = vi.fn(async () => undefined);
      const removeWorkspace = vi.fn(async (path: string) => rm(path, { force: true, recursive: true }));
      const child = { exitCode: null, kill: vi.fn(), signalCode: null };
      const error = new Error(`injected_${failurePoint}_failure`);
      await expect(runGuidedAgentCanary({}, {
        createWorkspace: async () => workspace,
        allocatePort: async () => 28112,
        prepareFixture: async ({ instanceDirectory }: { instanceDirectory: string }) => {
          await mkdir(join(instanceDirectory, "bin"), { recursive: true });
          return {
            fixtureAnswers: ["fixture answer"],
            sessionIds: Array.from({ length: 9 }, (_, index) => `session:fixture:${index}`)
          };
        },
        spawnDaemon: () => child,
        waitForHealth: async () => { if (failurePoint === "startup") throw error; },
        createRequest: async () => ({
          requestId: "request:canary",
          startCommand: `${workspace}/instance/bin/mastheadctl workbench author start --request request:canary --json`
        }),
        readRevisions: async () => ({ logbook: 0, workbench: 0 }),
        probeIdentityMismatch: async () => 0,
        runAgent: async ({ agentWorkspace }: { agentWorkspace: string }) => {
          expect(agentWorkspace).toBe(join(workspace, "agent"));
          expect(agentWorkspace.startsWith(process.cwd())).toBe(false);
          expect(await readdir(agentWorkspace)).toEqual([]);
          if (failurePoint === "agent") throw error;
          return passingAgentReport();
        },
        verifyGate: async () => { if (failurePoint === "gate") throw error; return []; },
        terminateChild,
        removeWorkspace
      })).rejects.toThrow(error.message);
      expect(terminateChild).toHaveBeenCalledOnce();
      expect(terminateChild).toHaveBeenCalledWith(child);
      expect(removeWorkspace).toHaveBeenCalledWith(workspace);
      await expect(import("node:fs/promises").then(({ access }) => access(workspace))).rejects.toMatchObject({ code: "ENOENT" });
    }
  );
});

function passingAgentReport(): Record<string, unknown> {
  return {
    acceptedArtifactIds: ["artifact:one"],
    acceptedArtifactKindCounts: { adr: 1, incident_timeline: 1, runbook: 1, session_dossier: 9 },
    artifactOnlyReusePassRate: 1,
    canaryPublishedBeforeApprovalCount: 0,
    completeEvidenceCoverage: 1,
    draftRevisionCount: 2,
    duplicateSessionTemplateCount: 0,
    findingCodes: ["missing_session_claim_support"],
    harnessSuppliedAuthoredContent: false,
    humanReview: { independentReusePassed: true, signed: true, specificityPassed: true },
    identityMismatchMutationCount: 0,
    outOfBandSessionListRequired: false,
    opportunityKindCounts: { adr: 1, incident_timeline: 1, runbook: 1 },
    optionalArtifactOnlyReusePassRate: 1,
    protocolLeakCount: 0,
    unboundedGenericDismissalCount: 0,
    unsupportedCompletionCount: 0
  };
}
