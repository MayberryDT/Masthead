// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryPanel } from "../../../ui/HistoryPanel";
import { useLogbookController } from "../useLogbookController";
import {
  getLogbookArtifact,
  listProjects,
  searchLogbook,
  type LogbookArtifactDetail,
  type LogbookSession
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  getLogbookArtifact: vi.fn(),
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
});

describe("useLogbookController artifact detail", () => {
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
    expect(Object.keys(daemonClientMocks)).toEqual(["getLogbookArtifact", "listProjects", "searchLogbook"]);
    expect(latestController).not.toHaveProperty("dossier");
    expect(latestController).not.toHaveProperty("transcript");
    expect(latestController).not.toHaveProperty("bulkEnrichFull");
    expect(latestController).not.toHaveProperty("selectedSessionIds");
    expect(latestController).not.toHaveProperty("summary");
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
  return (
    <HistoryPanel
      density="compact"
      detailError={logbook.detailError}
      detailLoading={logbook.detailLoading}
      filterOptions={logbook.filterOptions}
      filters={logbook.filters}
      loadState={logbook.loadState}
      pageIndex={logbook.pageIndex}
      pageSize={logbook.pageSize}
      query={logbook.query}
      refreshError={logbook.refreshError}
      selectedArtifact={logbook.selectedArtifact}
      selectedSessionId={logbook.selectedSessionId}
      sort={logbook.sort}
      onCloseDetail={logbook.closeSession}
      onFilterChange={logbook.changeFilters}
      onPageChange={logbook.changePage}
      onQueryChange={logbook.changeQuery}
      onRetry={logbook.retry}
      onSessionSelect={logbook.selectSession}
      onSortChange={logbook.changeSort}
    />
  );
}

function mockLogbookSearch(sessions: LogbookSession[], total: number): void {
  vi.mocked(searchLogbook).mockResolvedValue({ nextCursor: undefined, sessions, total });
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
