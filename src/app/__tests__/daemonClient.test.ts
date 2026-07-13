import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getWorkbenchMissingSessions,
  getWorkbenchAuthoringCapabilities,
  getWorkbenchArtifactCandidates,
  getWorkbenchActivity,
  getWorkbenchNotAddedSessions,
  getWorkbenchNotAddedSummary,
  getWorkbenchSessions,
  getKnowledgeFlowSummary,
  getLiveHookSettings,
  getRuntimeHookSettings,
  getSessionTranscript,
  getSourcesAdvanced,
  getSourcesSetup,
  getImportReport,
  installRuntimeHooks,
  listImports,
  listImportWorkUnits,
  listReviewDispositions,
  postWorkbenchCheckTranscript,
  postWorkbenchClaim,
  postWorkbenchEnrollMissing,
  postWorkbenchImportTranscript,
  postWorkbenchImportTranscriptPreview,
  postWorkbenchPublish,
  postWorkbenchPublishCanonicalDossiers,
  postWorkbenchQuality,
  postWorkbenchReleaseClaim,
  previewSourcesImport,
  rebuildEnrichments,
  repairSources,
  runSourcesSetup,
  saveReviewDisposition,
  searchLogbook,
  scanSourcesSetup,
  testRuntimeHooks,
  syncSources
} from "../daemonClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("daemon client review dispositions", () => {
  test("unions multi-value Logbook filters when the daemon only honors the first repeated param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = new URL(String(url));
        expect(requestUrl.pathname).toContain("/logbook/artifacts");
        const project = requestUrl.searchParams.get("project");
        return response({
          artifacts: project
            ? [
                {
                  artifactId: project === "Project one" ? "artifact-one" : "artifact-two",
                  confidence: "high",
                  kind: "runbook",
                  project,
                  provenanceLabel: "1 session",
                  provenanceSize: 1,
                  publishedAt: project === "Project one" ? "2026-07-03T10:00:00.000Z" : "2026-07-03T11:00:00.000Z",
                  status: "current",
                  summary: `${project} summary`,
                  title: `${project} session`
                }
              ]
            : [],
          total: project ? 1 : 0
        });
      })
    );

    await expect(
      searchLogbook({ limit: 50, offset: 0, project: ["Project one", "Project two"], sort: "recent" }, "http://127.0.0.1:17373/projection")
    ).resolves.toMatchObject({
      sessions: [
        { project: "Project two", sessionId: "artifact-two" },
        { project: "Project one", sessionId: "artifact-one" }
      ],
      total: 2
    });
  });

  test("passes explicit kind into artifact logbook search and ignores state-as-kind", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toContain("/logbook/artifacts");
      expect(requestUrl.searchParams.get("kind")).toBe("adr");
      return response({
        artifacts: [
          {
            artifactId: "artifact-adr",
            confidence: "high",
            kind: "adr",
            project: "Masthead",
            provenanceLabel: "1 session",
            provenanceSize: 1,
            publishedAt: "2026-07-03T10:00:00.000Z",
            status: "current",
            summary: "ADR summary",
            title: "ADR title"
          }
        ],
        total: 1
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchLogbook(
        { kind: "adr", limit: 50, offset: 0, q: "decision", sort: "recent", state: "runbook" },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toMatchObject({
      sessions: [{ sessionId: "artifact-adr", title: "ADR title" }],
      total: 1
    });

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("kind")).toBe("adr");
    expect(requested.searchParams.get("q")).toBe("decision");
  });

  test("passes dateFrom and dateTo into artifact logbook search query", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toContain("/logbook/artifacts");
      return response({
        artifacts: [
          {
            artifactId: "artifact-dated",
            confidence: "high",
            kind: "runbook",
            project: "Masthead",
            provenanceLabel: "1 session",
            provenanceSize: 1,
            publishedAt: "2026-06-15T12:00:00.000Z",
            status: "current",
            summary: "Dated summary",
            title: "Dated runbook"
          }
        ],
        total: 1
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchLogbook(
        {
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30",
          limit: 50,
          offset: 0,
          q: "dated"
        },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toMatchObject({
      sessions: [{ sessionId: "artifact-dated", title: "Dated runbook" }],
      total: 1
    });

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("dateFrom")).toBe("2026-06-01");
    expect(requested.searchParams.get("dateTo")).toBe("2026-06-30");
    expect(requested.searchParams.get("q")).toBe("dated");
  });

  test("loads sources setup state from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          setup: {
            connectedSources: [],
            setupId: "setup:1",
            status: "empty",
            updatedAt: "2026-06-27T10:00:00.000Z"
          }
        })
      )
    );

    await expect(getSourcesSetup("http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      setupId: "setup:1",
      status: "empty"
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/setup", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts sources setup actions to the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          queued: 0,
          scan: {
            adapters: [],
            foundSources: [],
            generatedAt: "2026-06-27T10:00:00.000Z",
            scanId: "scan:1",
            status: "completed",
            summary: {
              detectedHarnesses: 0,
              foundSources: 0,
              scannedHarnesses: 0
            }
          },
          setup: {
            connectedSources: [],
            setupId: "setup:1",
            status: "empty",
            updatedAt: "2026-06-27T10:00:00.000Z"
          }
        })
      )
    );

    await scanSourcesSetup("http://127.0.0.1:17373/projection");
    await runSourcesSetup({ importMetadata: true, runtimes: ["opencode"] }, "http://127.0.0.1:17373/projection");
    await syncSources("http://127.0.0.1:17373/projection");
    await repairSources("http://127.0.0.1:17373/projection");

    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/sources/setup/scan", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/sources/setup/run", {
      body: JSON.stringify({ importMetadata: true, runtimes: ["opencode"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(3, "http://127.0.0.1:17373/sources/sync", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(fetch).toHaveBeenNthCalledWith(4, "http://127.0.0.1:17373/sources/repair", {
      body: undefined,
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("loads sources advanced diagnostics from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          advanced: {
            adapters: [],
            imports: [],
            sources: []
          },
          ok: true
        })
      )
    );

    await expect(getSourcesAdvanced("http://127.0.0.1:17373/projection")).resolves.toEqual({
      adapters: [],
      imports: [],
      sources: []
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/advanced", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("loads Workbench missing sessions from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          generatedAt: "2026-07-08T00:00:00.000Z",
          limit: 25,
          sessions: []
        })
      )
    );

    await getWorkbenchMissingSessions("http://127.0.0.1:17373/projection", { limit: 25 });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/workbench/missing-sessions?limit=25",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  test("loads the Knowledge flow summary from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          summary: {
            capturedSessions: 3,
            workbenchSessions: 2,
            publishedArtifacts: 2,
            automaticallyResolvedSessions: 1
          }
        })
      )
    );

    await expect(getKnowledgeFlowSummary("http://127.0.0.1:17373/projection")).resolves.toEqual({
      capturedSessions: 3,
      workbenchSessions: 2,
      publishedArtifacts: 2,
      automaticallyResolvedSessions: 1
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/knowledge-flow/summary", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("loads Workbench pipeline endpoints from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          generatedAt: "2026-07-08T00:00:00.000Z",
          limit: 25,
          scope: "default",
          sessions: [],
          activity: [],
          reasons: [],
          total: 0
        })
      )
    );

    await getWorkbenchSessions("http://127.0.0.1:17373/projection", { limit: 25 });
    await getWorkbenchActivity("http://127.0.0.1:17373/projection", { limit: 10, sessionId: "session:1" });
    await getWorkbenchNotAddedSummary("http://127.0.0.1:17373/projection");
    await getWorkbenchNotAddedSessions("http://127.0.0.1:17373/projection", { limit: 10 });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:17373/workbench/sessions?limit=25",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:17373/workbench/activity?limit=10&sessionId=session%3A1",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:17373/workbench/not-added-summary",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:17373/workbench/not-added?includeDetails=true&limit=10",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  test("loads authoring capabilities relative to the active connector", async () => {
    const capabilities = {
      bundleVersion: "workbench-authoring-v2",
      capability: "artifact_authoring",
      command: "/home/test/.local/bin/mastheadctl",
      databaseId: "database:test",
      evidencePolicy: "candidate_scoped_canonical_evidence",
      evidenceRequirements: {
        adr: ["context", "decision", "alternatives"],
        incident_timeline: ["symptom", "ordered_events", "remediation"],
        runbook: ["problem", "change", "verification"]
      },
      operations: ["candidates", "open", "status", "evidence", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      transport: "daemon_http"
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(capabilities)));

    await expect(
      getWorkbenchAuthoringCapabilities("http://127.0.0.1:17374/projection?stale=true")
    ).resolves.toEqual(capabilities);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17374/workbench/authoring/capabilities",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  test("loads a bounded artifact candidate page from the active connector", async () => {
    const page = { candidates: [], nextCursor: "cursor:next" };
    vi.stubGlobal("fetch", vi.fn(async () => response(page)));

    await expect(
      getWorkbenchArtifactCandidates("http://127.0.0.1:17374/projection?stale=true", {
        kind: "runbook",
        limit: 25,
        status: "pending"
      })
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17374/workbench/authoring/candidates?kind=runbook&limit=25&status=pending",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  test("publishes canonical dossiers with one daemon-owned batch request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, receipt: { artifactIds: [], sessionIds: [] } })));

    await postWorkbenchPublishCanonicalDossiers("http://127.0.0.1:17373/projection", {
      actorId: "workbench_ui",
      sessionIds: ["session:1", "session:2"]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/workbench/dossiers/publish", {
      body: JSON.stringify({ actorId: "workbench_ui", sessionIds: ["session:1", "session:2"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
  });

  test("rejects authoring capabilities that do not identify an absolute installed command", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          bundleVersion: "workbench-authoring-v1",
          capability: "artifact_authoring",
          command: "mastheadctl",
          databaseId: "database:test",
          evidencePolicy: "all_canonical_redacted_evidence",
          operations: ["open", "status", "evidence", "submit", "finish"],
          protocol: "masthead.workbench.authoring/v1",
          transport: "daemon_http"
        })
      )
    );

    await expect(
      getWorkbenchAuthoringCapabilities("http://127.0.0.1:17373/projection")
    ).rejects.toThrow("absolute installed command");
  });

  test.each([
    ["capability", { capability: "other" }],
    ["protocol", { protocol: "masthead.workbench.authoring/v0" }],
    ["transport", { transport: "direct_sqlite" }],
    ["bundleVersion", { bundleVersion: "workbench-authoring-v0" }],
    ["evidencePolicy", { evidencePolicy: "preview" }],
    ["databaseId", { databaseId: "   " }],
    ["padded databaseId", { databaseId: " database:test " }],
    ["padded command", { command: " /home/test/.local/bin/mastheadctl " }],
    ["operations missing", { operations: ["open", "status", "evidence", "submit"] }],
    ["operations extra", { operations: ["open", "status", "evidence", "submit", "finish", "apply"] }],
    ["operations order", { operations: ["status", "open", "evidence", "submit", "finish"] }]
  ])("rejects a mismatched authoring %s contract", async (_label, override) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          bundleVersion: "workbench-authoring-v1",
          capability: "artifact_authoring",
          command: "/home/test/.local/bin/mastheadctl",
          databaseId: "database:test",
          evidencePolicy: "all_canonical_redacted_evidence",
          operations: ["open", "status", "evidence", "submit", "finish"],
          protocol: "masthead.workbench.authoring/v1",
          transport: "daemon_http",
          ...override
        })
      )
    );

    await expect(
      getWorkbenchAuthoringCapabilities("http://127.0.0.1:17373/projection")
    ).rejects.toThrow("complete daemon-owned contract");
  });

  test("posts Workbench pipeline write actions to the daemon", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true })));

    const base = "http://127.0.0.1:17373/projection";
    await postWorkbenchEnrollMissing(base, { limit: 500 });
    await postWorkbenchCheckTranscript(base, "session:1");
    await postWorkbenchImportTranscriptPreview(base, "session:1", { sourceId: "source:allowed" });
    await postWorkbenchImportTranscript(base, "session:1", { sourceId: "source:allowed" });
    await postWorkbenchPublish(base, "session:1");
    await postWorkbenchClaim(base, "session:1", { claimedBy: "ui-user", ttlSeconds: 300 });
    await postWorkbenchReleaseClaim(base, "claim:abc", { reason: "done" });
    await postWorkbenchQuality(base, "session:1", { status: "passed" });
    await postWorkbenchQuality(base, "session:1", { status: "failed", reason: "hook_only_noise" });
    await postWorkbenchQuality(base, "session:1", { mode: "precheck" });

    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/workbench/enroll-missing", {
      body: JSON.stringify({ limit: 500 }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/workbench/sessions/session%3A1/check-transcript", {
      headers: { accept: "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(3, "http://127.0.0.1:17373/workbench/sessions/session%3A1/import-transcript-preview", {
      body: JSON.stringify({ sourceId: "source:allowed" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(4, "http://127.0.0.1:17373/workbench/sessions/session%3A1/import-transcript", {
      body: JSON.stringify({ sourceId: "source:allowed" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(5, "http://127.0.0.1:17373/workbench/sessions/session%3A1/publish", {
      headers: { accept: "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(6, "http://127.0.0.1:17373/workbench/sessions/session%3A1/claim", {
      body: JSON.stringify({ claimedBy: "ui-user", ttlSeconds: 300 }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(7, "http://127.0.0.1:17373/workbench/claims/claim%3Aabc/release", {
      body: JSON.stringify({ reason: "done" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(8, "http://127.0.0.1:17373/workbench/sessions/session%3A1/quality", {
      body: JSON.stringify({ status: "passed" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(9, "http://127.0.0.1:17373/workbench/sessions/session%3A1/quality", {
      body: JSON.stringify({ status: "failed", reason: "hook_only_noise" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
    expect(fetch).toHaveBeenNthCalledWith(10, "http://127.0.0.1:17373/workbench/sessions/session%3A1/quality", {
      body: JSON.stringify({ mode: "precheck" }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST",
      signal: undefined
    });
  });

  test("loads paged import jobs from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          imports: [{ importJobId: "job-1", sourceId: "opencode-sessions" }],
          limit: 25,
          offset: 50,
          total: 100
        })
      )
    );

    await expect(
      listImports("http://127.0.0.1:17373/projection", {
        adapterId: "opencode",
        limit: 25,
        offset: 50,
        sourceId: "opencode-sessions",
        status: "active"
      })
    ).resolves.toMatchObject({
      imports: [{ importJobId: "job-1", sourceId: "opencode-sessions" }],
      limit: 25,
      offset: 50,
      total: 100
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/imports?limit=25&offset=50&adapterId=opencode&sourceId=opencode-sessions&status=active",
      { headers: { accept: "application/json" }, signal: undefined }
    );
  });

  test("previews a harness-first sources import", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          previews: [
            {
              runtime: "opencode",
              summary: {
                excludedUnits: 1,
                generatedAt: "2026-07-01T00:00:00.000Z",
                importJobId: "preview:opencode",
                importKind: "transcript",
                includedUnits: 2,
                manifestId: "",
                runtime: "opencode",
                scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
                totalBytes: 120,
                totalUnits: 3
              }
            }
          ]
        })
      )
    );

    await expect(
      previewSourcesImport("http://127.0.0.1:17373/projection", {
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        runtimes: ["opencode"]
      })
    ).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/import/preview", {
      body: JSON.stringify({
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        runtimes: ["opencode"]
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });

  test("loads import work units and completion reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ ok: true, limit: 50, offset: 0, units: [{ status: "succeeded", workUnitId: "unit-1" }] }))
        .mockResolvedValueOnce(response({ ok: true, report: { importJobId: "job-1", sessionsCreated: 1 } }))
    );

    await expect(
      listImportWorkUnits("http://127.0.0.1:17373/projection", "job-1", { limit: 50, status: "succeeded" })
    ).resolves.toEqual({
      limit: 50,
      offset: 0,
      units: [{ status: "succeeded", workUnitId: "unit-1" }]
    });
    await expect(getImportReport("http://127.0.0.1:17373/projection", "job-1")).resolves.toMatchObject({
      importJobId: "job-1",
      sessionsCreated: 1
    });
    expect(fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17373/imports/job-1/units?limit=50&status=succeeded", {
      headers: { accept: "application/json" }
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17373/imports/job-1/report", {
      headers: { accept: "application/json" }
    });
  });

  test("loads paginated session transcripts from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          coverage: {
            assistantMessages: 1,
            checkpoints: 0,
            fileEffects: 0,
            hasUsableTranscript: true,
            lowValueItems: 0,
            messages: 2,
            runtimeSignals: 0,
            toolCalls: 0,
            toolResults: 0,
            userMessages: 1
          },
          items: [{ itemId: "message:1", kind: "message", label: "user", role: "user", text: "hello" }],
          nextCursor: "100",
          total: 101
        })
      )
    );

    await expect(
      getSessionTranscript(
        "session 1",
        { cursor: "50", kind: "assistant", limit: 25, q: "sqlite" },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toMatchObject({
      nextCursor: "100",
      total: 101
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/sessions/session%201/transcript?cursor=50&limit=25&kind=assistant&q=sqlite",
      { headers: { accept: "application/json" }, signal: undefined }
    );
  });

  test("throws when session transcript loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failedResponse(503)));

    await expect(getSessionTranscript("session-1", {}, "http://127.0.0.1:17373/projection")).rejects.toThrow(
      "session transcript failed: 503"
    );
  });

  test("loads review dispositions from the daemon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ok: true, dispositions: [{ dispositionId: "review:1", subjectId: "session-1" }] }))
    );

    await expect(listReviewDispositions("http://127.0.0.1:17373/projection")).resolves.toEqual([
      { dispositionId: "review:1", subjectId: "session-1" }
    ]);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/review-dispositions", {
      headers: { accept: "application/json" }
    });
  });

  test("saves review dispositions to the daemon", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true })));

    await saveReviewDisposition(
      {
        dispositionId: "review:session:session-1:reviewed",
        recordedAt: "2026-06-25T12:00:00.000Z",
        status: "reviewed",
        subjectId: "session-1",
        subjectType: "session"
      },
      "http://127.0.0.1:17373/projection"
    );

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/review-dispositions", {
      body: JSON.stringify({
        dispositionId: "review:session:session-1:reviewed",
        recordedAt: "2026-06-25T12:00:00.000Z",
        status: "reviewed",
        subjectId: "session-1",
        subjectType: "session"
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });
});

describe("daemon client enrichment rebuilds", () => {
  test("posts rebuild depth and strips the transport ok field from the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          failed: 0,
          ok: true,
          requested: 2,
          sessions: [
            { sessionId: "session-1", status: "succeeded" },
            { sessionId: "session-2", status: "succeeded" }
          ],
          succeeded: 2
        })
      )
    );

    await expect(
      rebuildEnrichments(
        { depth: "summary", limit: 2, scope: "sessionIds", sessionIds: ["session-1", "session-2"] },
        "http://127.0.0.1:17373/projection"
      )
    ).resolves.toEqual({
      failed: 0,
      requested: 2,
      sessions: [
        { sessionId: "session-1", status: "succeeded" },
        { sessionId: "session-2", status: "succeeded" }
      ],
      succeeded: 2
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/enrichment/rebuild", {
      body: JSON.stringify({ depth: "summary", limit: 2, scope: "sessionIds", sessionIds: ["session-1", "session-2"] }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
  });
});

describe("daemon client runtime hook helpers", () => {
  test("loads hook settings from the runtime-scoped settings endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "claude_code" }) })));

    await expect(getRuntimeHookSettings("claude_code", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "claude_code" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/claude_code", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });

  test("posts hook actions to the selected supported runtime route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "claude_code" }) })));

    await expect(testRuntimeHooks("claude_code", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "claude_code" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/claude_code/test", {
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("keeps OpenCode on the same runtime-scoped hook action path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: true, hooks: hookSettings({ runtime: "opencode" }) })));

    await expect(installRuntimeHooks("opencode", "http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [expect.objectContaining({ runtime: "opencode" })]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks/opencode/install", {
      headers: { accept: "application/json" },
      method: "POST"
    });
  });

  test("loads aggregate hook settings without choosing a runtime-specific action route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ok: true,
          hooks: {
            ...hookSettings({ runtime: "opencode" }),
            integrations: [
              hookSettings({ runtime: "claude_code" }).integrations[0],
              hookSettings({ runtime: "opencode" }).integrations[0],
              hookSettings({ runtime: "omp" }).integrations[0]
            ]
          }
        })
      )
    );

    await expect(getLiveHookSettings("http://127.0.0.1:17373/projection")).resolves.toMatchObject({
      integrations: [
        expect.objectContaining({ runtime: "claude_code" }),
        expect.objectContaining({ runtime: "opencode" }),
        expect.objectContaining({ runtime: "omp" })
      ]
    });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/settings/hooks", {
      headers: { accept: "application/json" },
      signal: undefined
    });
  });
});

function response(body: unknown): Response {
  return {
    json: async () => body,
    ok: true,
    status: 200
  } as Response;
}

function hookSettings({ runtime }: { runtime: string }) {
  return {
    command: "masthead hook",
    configExists: true,
    configPath: `/home/tyler/.${runtime}/hooks.json`,
    endpoint: `http://127.0.0.1:17373/ingest?runtime=${runtime}`,
    installed: true,
    integrations: [
      {
        actionSurface: "sources",
        captureMode: "live_hook",
        description: `${runtime} live hooks`,
        label: runtime,
        runtime,
        status: "installed",
        supportsActions: true
      }
    ],
    missingEvents: [],
    mismatchedEvents: []
  };
}

function failedResponse(status: number): Response {
  return {
    json: async () => ({ ok: false }),
    ok: false,
    status
  } as Response;
}
