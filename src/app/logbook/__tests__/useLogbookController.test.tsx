// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryPanel } from "../../../ui/HistoryPanel";
import { useLogbookController } from "../useLogbookController";
import { getDataRevisions, getLogbookArtifact, getSessionTranscript, listProjects, searchLogbook, type LogbookArtifactDetail, type LogbookSession } from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getDataRevisions: vi.fn().mockResolvedValue({ logbook: 0, workbench: 0 }),
  getLogbookArtifact: vi.fn(),
  getSessionTranscript: vi.fn(),
  listProjects: vi.fn(),
  searchLogbook: vi.fn()
}));

vi.mock("../../daemonClient", () => daemonClientMocks);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latestController: ReturnType<typeof useLogbookController> | undefined;

const baseUrl = "http://127.0.0.1:17373/projection";

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  latestController = undefined;
  vi.clearAllMocks();
  vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 0, workbench: 0 });
});

describe("useLogbookController artifact detail", () => {
  test("evicts an empty page cache when the daemon Logbook revision advances", async () => {
    vi.mocked(searchLogbook)
      .mockResolvedValueOnce({ nextCursor: undefined, sessions: [], total: 0 })
      .mockResolvedValueOnce({ nextCursor: undefined, sessions: [session("artifact:new", "Published externally")], total: 1 });
    vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 0, workbench: 0 });
    await renderHarness();
    await flushAsync();
    expect(latestController?.loadState).toMatchObject({ state: "ready", total: 0 });

    vi.mocked(getDataRevisions).mockResolvedValue({ logbook: 1, workbench: 0 });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    expect(latestController?.loadState).toMatchObject({ state: "ready", total: 1 });
    expect(searchLogbook).toHaveBeenCalledTimes(2);
  });

  test("loads canonical dossier transcript evidence from its single provenance session through pagination", async () => {
    mockLogbookSearch([session("artifact-canonical", "Canonical dossier")], 1);
    vi.mocked(getLogbookArtifact).mockResolvedValueOnce(canonicalArtifactDetail("artifact-canonical", "canonical-session-1"));
    vi.mocked(getSessionTranscript).mockResolvedValueOnce(transcriptPage("first", "cursor-2")).mockResolvedValueOnce(transcriptPage("second"));
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("artifact-canonical");
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    expect(getSessionTranscript).toHaveBeenNthCalledWith(1, "canonical-session-1", expect.objectContaining({ cursor: undefined }), baseUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getSessionTranscript).toHaveBeenNthCalledWith(2, "canonical-session-1", expect.objectContaining({ cursor: "cursor-2" }), baseUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(latestController?.selectedArtifact?.provenanceTranscript?.items.map((item) => item.text)).toEqual(["first", "second"]);
    expect(latestController?.selectedArtifact?.provenanceTranscript?.nextCursor).toBeUndefined();
  });

  test("shows transcript loading without claiming evidence is absent", async () => {
    mockLogbookSearch([session("artifact-canonical", "Canonical dossier")], 1);
    vi.mocked(getLogbookArtifact).mockResolvedValueOnce(canonicalArtifactDetail("artifact-canonical", "canonical-session-1"));
    let resolveTranscript: ((value: ReturnType<typeof transcriptPage>) => void) | undefined;
    vi.mocked(getSessionTranscript).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscript = resolve;
        })
    );
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("artifact-canonical");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedArtifact?.provenanceTranscriptLoading).toBe(true);
    expect(container?.textContent).toContain("Loading transcript...");
    expect(container?.textContent).not.toContain("No transcript evidence captured.");

    await act(async () => {
      resolveTranscript?.(transcriptPage("loaded"));
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedArtifact?.provenanceTranscriptLoading).toBe(false);
    expect(container?.textContent).toContain("loaded");
  });

  test("keeps the canonical dossier readable when provenance transcript loading fails", async () => {
    mockLogbookSearch([session("artifact-canonical", "Canonical dossier")], 1);
    vi.mocked(getLogbookArtifact).mockResolvedValueOnce(canonicalArtifactDetail("artifact-canonical", "canonical-session-1"));
    vi.mocked(getSessionTranscript).mockRejectedValueOnce(new Error("transcript unavailable"));
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("artifact-canonical");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedArtifact?.title).toBe("Artifact");
    expect(latestController?.detailError).toBeUndefined();
    expect(latestController?.selectedArtifact?.provenanceTranscriptError).toBe("Could not load transcript evidence");
    expect(container?.textContent).toContain("Transcript error: Could not load transcript evidence");
  });

  test("selecting a row id loads artifact detail via getLogbookArtifact", async () => {
    mockLogbookSearch([session("session-a", "First artifact")], 1);
    vi.mocked(getLogbookArtifact).mockResolvedValueOnce(artifactDetail("session-a", "Problem body"));
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("session-a");
      await Promise.resolve();
    });
    await flushAsync();

    expect(getLogbookArtifact).toHaveBeenCalledWith("session-a", baseUrl, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(latestController?.selectedSessionId).toBe("session-a");
    expect(latestController?.selectedArtifact?.title).toBe("First");
    expect(latestController?.detailLoading).toBe(false);
    expect(latestController?.detailError).toBeUndefined();
    expect(container?.textContent).toContain("Problem body");
  });

  test("clears previous artifact body immediately when selection changes", async () => {
    mockLogbookSearch([session("session-a", "First"), session("session-b", "Second")], 2);
    let resolveB: ((value: LogbookArtifactDetail) => void) | undefined;
    vi.mocked(getLogbookArtifact)
      .mockResolvedValueOnce(artifactDetail("session-a", "First body"))
      .mockImplementationOnce(
        () =>
          new Promise<LogbookArtifactDetail>((resolve) => {
            resolveB = resolve;
          })
      );
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("session-a");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedArtifact?.title).toBe("First");
    expect(container?.textContent).toContain("First body");
    expect(latestController?.detailLoading).toBe(false);

    await act(async () => {
      latestController?.selectSession("session-b");
      await Promise.resolve();
    });

    expect(latestController?.selectedSessionId).toBe("session-b");
    expect(latestController?.selectedArtifact).toBeUndefined();
    expect(latestController?.detailLoading).toBe(true);
    expect(container?.textContent).not.toContain("First body");
    expect(container?.textContent).toContain("Loading artifact");

    await act(async () => {
      resolveB?.(artifactDetail("session-b", "Second body"));
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedArtifact?.title).toBe("Second");
    expect(container?.textContent).toContain("Second body");
    expect(container?.textContent).not.toContain("First body");
  });

  test("surfaces a user-visible error when artifact detail fails to load", async () => {
    mockLogbookSearch([session("session-err", "Broken artifact")], 1);
    vi.mocked(getLogbookArtifact).mockRejectedValueOnce(new Error("network down"));
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("session-err");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.detailLoading).toBe(false);
    expect(latestController?.selectedArtifact).toBeUndefined();
    expect(latestController?.detailError).toBe("Could not load artifact");
    expect(container?.textContent).toContain("Could not load artifact");
  });

  test("does not load dossier or transcript side effects for selection", async () => {
    mockLogbookSearch([session("session-a", "First")], 1);
    vi.mocked(getLogbookArtifact).mockResolvedValueOnce(artifactDetail("session-a", "Body"));
    await renderHarness();

    await act(async () => {
      latestController?.selectSession("session-a");
      await Promise.resolve();
    });
    await flushAsync();

    expect(getLogbookArtifact).toHaveBeenCalledTimes(1);
    expect(getSessionTranscript).not.toHaveBeenCalled();
    expect(latestController).not.toHaveProperty("dossier");
    expect(latestController).not.toHaveProperty("transcript");
    expect(latestController).not.toHaveProperty("bulkEnrichFull");
    expect(latestController).not.toHaveProperty("selectedSessionIds");
    expect(latestController).not.toHaveProperty("summary");
  });

  test("keeps open dossier when changing page; X closes; selecting another artifact switches", async () => {
    const page0 = [session("session-a", "First artifact")];
    const page1 = [session("session-b", "Second page artifact")];
    vi.mocked(searchLogbook)
      .mockResolvedValueOnce({ nextCursor: "page-1", sessions: page0, total: 2 })
      .mockResolvedValueOnce({ nextCursor: undefined, sessions: page1, total: 2 });
    vi.mocked(getLogbookArtifact)
      .mockResolvedValueOnce(artifactDetail("session-a", "First body"))
      .mockResolvedValueOnce(artifactDetail("session-b", "Second body"));
    await renderHarness();
    await flushAsync();

    await act(async () => {
      latestController?.selectSession("session-a");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedSessionId).toBe("session-a");
    expect(latestController?.selectedArtifact?.title).toBe("First");
    expect(container?.textContent).toContain("First body");
    expect(getLogbookArtifact).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestController?.changePage(1);
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.pageIndex).toBe(1);
    expect(latestController?.selectedSessionId).toBe("session-a");
    expect(latestController?.selectedArtifact?.title).toBe("First");
    expect(container?.textContent).toContain("First body");
    expect(getLogbookArtifact).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestController?.closeSession();
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedSessionId).toBeUndefined();
    expect(latestController?.selectedArtifact).toBeUndefined();
    expect(container?.textContent).not.toContain("First body");

    await act(async () => {
      latestController?.selectSession("session-b");
      await Promise.resolve();
    });
    await flushAsync();

    expect(latestController?.selectedSessionId).toBe("session-b");
    expect(latestController?.selectedArtifact?.title).toBe("Second");
    expect(container?.textContent).toContain("Second body");
  });
});

async function renderHarness(): Promise<void> {
  mockMetadata();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<LogbookHarness />);
  });
  await flushAsync();
}

function canonicalArtifactDetail(artifactId: string, provenanceSessionId: string): LogbookArtifactDetail {
  return {
    ...artifactDetail(artifactId, "ignored legacy problem"),
    body: canonicalDossierBody(provenanceSessionId),
    provenanceSessionIds: [provenanceSessionId],
    schemaVersion: "canonical-session-dossier-v1"
  };
}

function canonicalDossierBody(sessionId: string) {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    capturedAt: "2026-07-12T18:00:00.000Z",
    attention: [],
    coverage: {
      level: "complete",
      transcript: transcriptCoverage(),
      warnings: []
    },
    enrichment: { status: "current" },
    excerpts: [],
    files: [],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-07-12T18:00:00.000Z",
      lifecycle: "ended",
      models: ["gpt-5"],
      project: "Masthead",
      runtime: "codex",
      sessionId,
      sourceConfidence: "authoritative",
      sourceSessionId: `source:${sessionId}`,
      startedAt: "2026-07-12T17:00:00.000Z",
      title: "Canonical dossier"
    },
    narrative: {
      objective: "Restore the original dossier.",
      technologies: [],
      topics: [],
      unresolved: []
    },
    reuse: {
      canonicalSessionId: sessionId,
      copyableContext: "Canonical dossier",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: `source:${sessionId}`
    },
    timeline: [],
    tools: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 },
    verification: { commands: [], status: "not_run", summary: "Not run." }
  };
}

function transcriptCoverage() {
  return {
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
  };
}

function transcriptPage(text: string, nextCursor?: string) {
  return {
    coverage: transcriptCoverage(),
    items: [
      {
        itemId: `message:${text}`,
        kind: "message" as const,
        label: "assistant",
        observedAt: "2026-07-12T18:00:00.000Z",
        role: "assistant" as const,
        sessionId: "canonical-session-1",
        sourceRef: {},
        text
      }
    ],
    nextCursor,
    total: 2
  };
}

function LogbookHarness() {
  const logbook = useLogbookController({
    activeProjectionUrl: baseUrl,
    activeSurface: "logbook",
    adapters: [],
    externalRefreshKey: 0,
    isLive: true
  });
  useEffect(() => {
    latestController = logbook;
  });
  return <HistoryPanel density="compact" detailError={logbook.detailError} detailLoading={logbook.detailLoading} filterOptions={logbook.filterOptions} filters={logbook.filters} loadState={logbook.loadState} pageIndex={logbook.pageIndex} pageSize={logbook.pageSize} query={logbook.query} refreshError={logbook.refreshError} selectedArtifact={logbook.selectedArtifact} selectedSessionId={logbook.selectedSessionId} sort={logbook.sort} onCloseDetail={logbook.closeSession} onFilterChange={logbook.changeFilters} onPageChange={logbook.changePage} onQueryChange={logbook.changeQuery} onRetry={logbook.retry} onSessionSelect={logbook.selectSession} onSortChange={logbook.changeSort} />;
}

function mockLogbookSearch(sessions: LogbookSession[], total: number): void {
  vi.mocked(searchLogbook).mockResolvedValue({
    nextCursor: undefined,
    sessions,
    total
  });
}

function mockMetadata(): void {
  vi.mocked(listProjects).mockResolvedValue([]);
}

function artifactDetail(sessionId: string, problemStatement: string): LogbookArtifactDetail {
  const title = sessionId === "session-a" ? "First" : sessionId === "session-b" ? "Second" : "Artifact";
  return {
    body: { problemStatement },
    capsule: {
      artifactId: sessionId,
      confidence: "high",
      kind: "session_dossier",
      project: "Masthead",
      provenanceLabel: "1 session",
      provenanceSize: 1,
      publishedAt: "2026-07-01T10:00:00.000Z",
      status: "published",
      summary: problemStatement,
      title
    },
    confidence: "high",
    contentFingerprint: `fp-${sessionId}`,
    createdAt: "2026-07-01T10:00:00.000Z",
    evidenceRefs: [],
    lineageId: `lineage-${sessionId}`,
    provenanceSessionIds: [sessionId],
    publicationStatus: "published",
    schemaVersion: "1",
    status: "ready",
    updatedAt: "2026-07-01T10:00:00.000Z"
  };
}

function session(sessionId: string, title: string): LogbookSession {
  return {
    errorCount: 0,
    fileCount: 0,
    hostId: "test-host",
    lastActivityAt: "2026-07-01T10:00:00.000Z",
    lifecycle: "ended",
    models: ["gpt-5"],
    project: "Masthead",
    runtime: "opencode",
    sessionId,
    sourceConfidence: "authoritative",
    sourceSessionId: `source:${sessionId}`,
    title,
    toolCount: 0,
    topics: [],
    unresolved: []
  };
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
