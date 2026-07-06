// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryPanel } from "../../../ui/HistoryPanel";
import { useLogbookController } from "../useLogbookController";
import {
  getLogbookSummary,
  listProjects,
  rebuildEnrichments,
  searchLogbook,
  type LogbookSession
} from "../../daemonClient";

const daemonClientMocks = vi.hoisted(() => ({
  enrichSessionDossier: vi.fn(),
  getLogbookSession: vi.fn(),
  getLogbookSessionExcerpts: vi.fn(),
  getLogbookSummary: vi.fn(),
  getSessionDossier: vi.fn(),
  getSessionTranscript: vi.fn(),
  listProjects: vi.fn(),
  rebuildEnrichments: vi.fn(),
  searchLogbook: vi.fn()
}));

vi.mock("../../daemonClient", () => daemonClientMocks);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const baseUrl = "http://127.0.0.1:17373/projection";

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllMocks();
});

describe("useLogbookController bulk enrichment", () => {
  test("sends summary and full rebuilds with the selected session ids and requested depth", async () => {
    mockLogbookSearch([session("session-1", "Repair OAuth callback")], 1);
    vi.mocked(rebuildEnrichments).mockResolvedValue({ failed: 0, requested: 1, sessions: [{ sessionId: "session-1", status: "succeeded" }], succeeded: 1 });
    await renderHarness();

    await clickCheckbox("Select Repair OAuth callback for bulk enrich");
    await clickButton("Enrich summaries");

    expect(rebuildEnrichments).toHaveBeenCalledWith(
      { depth: "summary", limit: 1, scope: "sessionIds", sessionIds: ["session-1"] },
      baseUrl
    );

    vi.mocked(rebuildEnrichments).mockClear();
    await clickButton("Enrich full sessions");

    expect(rebuildEnrichments).toHaveBeenCalledWith(
      { depth: "full", limit: 1, scope: "sessionIds", sessionIds: ["session-1"] },
      baseUrl
    );
  });

  test("requires typed confirmation before posting full enrichment for more than 50 selected sessions", async () => {
    const pageSessions = Array.from({ length: 51 }, (_, index) => session(`session-${index + 1}`, `Session ${index + 1}`));
    mockLogbookSearch(pageSessions, 51);
    vi.mocked(rebuildEnrichments).mockResolvedValue({ failed: 0, requested: 51, sessions: [], succeeded: 51 });
    await renderHarness();

    await clickCheckbox("Select Session 1 for bulk enrich");
    await clickButton("Select page");
    await clickButton("Enrich full sessions");

    expect(container?.textContent).toContain("Full enrichment can call the configured remote provider for 51 sessions. Type ENRICH to continue.");
    expect(rebuildEnrichments).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(true);

    await act(async () => {
      setInputValue(typedConfirmationInput(), "ENRICH");
      await Promise.resolve();
    });
    expect(confirmButton().disabled).toBe(false);

    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(rebuildEnrichments).toHaveBeenCalledWith(
      { depth: "full", limit: 51, scope: "sessionIds", sessionIds: pageSessions.map((row) => row.sessionId) },
      baseUrl
    );
  });

  test("selects all filtered matches through the Logbook search API with the server rebuild cap", async () => {
    const pageSession = session("session-page", "Visible page session");
    const matchingSessions = Array.from({ length: 500 }, (_, index) => session(`matching-${index + 1}`, `Matching ${index + 1}`));
    vi.mocked(searchLogbook)
      .mockResolvedValueOnce({ nextCursor: undefined, sessions: [pageSession], total: 750 })
      .mockResolvedValueOnce({ nextCursor: undefined, sessions: matchingSessions, total: 750 });
    mockMetadata();
    await renderHarness();

    await clickCheckbox("Select Visible page session for bulk enrich");
    await clickButton("Select all matching filter");

    expect(searchLogbook).toHaveBeenLastCalledWith(
      { limit: 500, offset: 0, q: "", sort: "recent" },
      baseUrl
    );
    expect(container?.textContent).toContain("500 selected");
    expect(container?.textContent).toContain("First 500 matching sessions selected.");
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
  return (
    <HistoryPanel
      bulkConfirmMessage={logbook.bulkConfirmMessage}
      bulkEnrichBusy={logbook.bulkEnrichBusy}
      bulkEnrichError={logbook.bulkEnrichError}
      bulkStatus={logbook.bulkStatus}
      bulkTargetCapped={logbook.bulkTargetCapped}
      bulkTargetCount={logbook.bulkTargetCount}
      bulkTargetKind={logbook.bulkTargetKind}
      density="compact"
      filterOptions={logbook.filterOptions}
      filters={logbook.filters}
      fullEnrichmentAvailable
      loadState={logbook.loadState}
      pageIndex={logbook.pageIndex}
      pageSize={logbook.pageSize}
      query={logbook.query}
      refreshError={logbook.refreshError}
      selectedSessionId={logbook.selectedSessionId}
      selectedSessionIds={logbook.selectedSessionIds}
      sort={logbook.sort}
      summary={logbook.summary}
      onBulkEnrichFull={() => void logbook.bulkEnrichFull()}
      onBulkEnrichSummary={() => void logbook.bulkEnrichSummary()}
      onCancelBulkEnrichFull={logbook.cancelBulkEnrichFull}
      onClearBulkSelection={logbook.clearBulkSelection}
      onConfirmBulkEnrichFull={() => void logbook.confirmBulkEnrichFull()}
      onFilterChange={logbook.changeFilters}
      onPageChange={logbook.changePage}
      onQueryChange={logbook.changeQuery}
      onRetry={logbook.retry}
      onSelectBulkFiltered={() => void logbook.selectAllMatchingFilter()}
      onSelectBulkPage={logbook.selectCurrentPage}
      onSessionSelect={logbook.selectSession}
      onSortChange={logbook.changeSort}
      onToggleBulkSelect={logbook.toggleBulkSelection}
    />
  );
}

function mockLogbookSearch(sessions: LogbookSession[], total: number): void {
  vi.mocked(searchLogbook).mockResolvedValue({ nextCursor: undefined, sessions, total });
}

function mockMetadata(): void {
  vi.mocked(getLogbookSummary).mockResolvedValue({ fileEffects: 0, lifecycles: [], messages: 0, models: [], projects: 0, runtimes: [], sessions: 0, toolCalls: 0 });
  vi.mocked(listProjects).mockResolvedValue([]);
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
    runtime: "codex",
    sessionId,
    sourceConfidence: "authoritative",
    sourceSessionId: `source:${sessionId}`,
    title,
    toolCount: 0,
    topics: [],
    unresolved: []
  };
}

async function clickButton(label: string): Promise<void> {
  await act(async () => {
    buttonByText(label).click();
    await Promise.resolve();
  });
}

async function clickCheckbox(label: string): Promise<void> {
  await act(async () => {
    checkboxByLabel(label).click();
    await Promise.resolve();
  });
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(currentContainer().querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function checkboxByLabel(label: string): HTMLInputElement {
  const checkbox = Array.from(currentContainer().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );
  expect(checkbox).toBeDefined();
  return checkbox as HTMLInputElement;
}

function typedConfirmationInput(): HTMLInputElement {
  const input = currentContainer().querySelector<HTMLInputElement>(".confirm-dialog input");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function confirmButton(): HTMLButtonElement {
  const button = currentContainer().querySelector<HTMLButtonElement>(".confirm-dialog .confirm-dialog-actions button:last-child");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
