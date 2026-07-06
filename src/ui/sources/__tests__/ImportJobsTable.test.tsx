// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ImportJob } from "../../../app/daemonClient";
import { ImportJobsTable } from "../ImportJobsTable";

describe("ImportJobsTable", () => {
  test("renders progress, current path, and cancel affordance for active imports", () => {
    const html = renderToStaticMarkup(
      <ImportJobsTable
        imports={[
          importJob({
            currentPath: "/home/tyler/.opencode/sessions/2026/06/25/session.jsonl",
            processedCount: 3,
            progressCurrent: 3,
            progressPercent: 30,
            progressTotal: 10,
            status: "running"
          })
        ]}
        onCancelImport={() => undefined}
      />
    );

    expect(html).toContain("3 / 10 (30%)");
    expect(html).not.toContain("/home/tyler/.opencode/sessions/2026/06/25/session.jsonl");
    expect(html).toContain("session.jsonl");
    expect(html).toContain("running");
    expect(html).toContain("Cancel");
  });

  test("does not show fake 100 percent progress when active import total is only processed so far", () => {
    const html = renderToStaticMarkup(
      <ImportJobsTable
        imports={[
          importJob({
            discoveredCount: 3953,
            importedCount: 3953,
            processedCount: 3953,
            progressCurrent: 3953,
            progressPercent: 100,
            progressTotal: 3953,
            status: "running"
          })
        ]}
        onCancelImport={() => undefined}
      />
    );

    expect(html).not.toContain("3953 / 3953");
    expect(html).not.toContain("100%");
    expect(html).toContain("3953 imported");
  });

  test("groups related import work by harness and shows stale heartbeat copy", () => {
    const html = renderToStaticMarkup(
      <ImportJobsTable
        imports={[
          importJob({
            completedWorkUnits: 6,
            failedWorkUnits: 1,
            heartbeatAt: "2026-06-25T11:52:00.000Z",
            importJobId: "opencode-parent",
            importedCount: 12,
            processedCount: 18,
            skippedWorkUnits: 2,
            sourceId: "opencode-sessions",
            status: "running",
            totalWorkUnits: 20,
            updatedAt: "2026-06-25T12:00:00.000Z"
          }),
          importJob({
            importJobId: "opencode-child-1",
            sourceId: "opencode-sessions",
            status: "succeeded",
            updatedAt: "2026-06-25T11:58:00.000Z"
          }),
          importJob({
            importJobId: "opencode-child-2",
            sourceId: "opencode-sessions",
            status: "failed",
            updatedAt: "2026-06-25T11:59:00.000Z"
          })
        ]}
        nowMs={new Date("2026-06-25T12:00:00.000Z").getTime()}
        staleAfterMs={5 * 60 * 1000}
      />
    );

    expect(html.match(/import-job-group-row/g)).toHaveLength(1);
    expect(html).toContain("OpenCode");
    expect(html).toContain("3 jobs");
    expect(html).toContain("12 imported");
    expect(html).toContain("2 skipped");
    expect(html).toContain("1 failed");
    expect(html).toContain("No heartbeat for 8 min");
    expect(html).not.toContain("opencode-child-1");
    expect(html).not.toContain("opencode-child-2");
  });

  test("renders retry affordance for failed and cancelled imports", () => {
    const html = renderToStaticMarkup(
      <ImportJobsTable
        imports={[
          importJob({ importJobId: "failed-job", status: "failed", failureMessage: "bad jsonl" }),
          importJob({ importJobId: "cancelled-job", status: "cancelled" })
        ]}
        onRetryImport={() => undefined}
      />
    );

    expect(html).toContain("bad jsonl");
    expect(html.match(/Retry/g)).toHaveLength(1);
  });

  test("invokes cancel and retry callbacks with job ids", async () => {
    const onCancelImport = vi.fn();
    const onRetryImport = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ImportJobsTable
          imports={[
            importJob({ importJobId: "running-job", status: "running" }),
            importJob({ importJobId: "failed-job", sourceId: "hermes-history", status: "failed" })
          ]}
          onCancelImport={onCancelImport}
          onRetryImport={onRetryImport}
        />
      );
    });

    await act(async () => {
      buttonByText(container, "Cancel").click();
      buttonByText(container, "Retry").click();
    });

    expect(onCancelImport).toHaveBeenCalledWith("running-job");
    expect(onRetryImport).toHaveBeenCalledWith("failed-job");

    await act(async () => root.unmount());
  });

  test("renders import queue title with compact header stats", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ImportJobsTable
          imports={[importJob({ importJobId: "newest-job" }), importJob({ importJobId: "older-job" })]}
          total={3}
        />
      );
    });

    expect(container.querySelector(".import-jobs-title")?.textContent).toBe("Import activity");
    expect(container.querySelector(".import-jobs-summary")?.textContent).toContain("Visible1");
    expect(container.querySelector(".import-jobs-summary")?.textContent).toContain("Total2");
    expect(container.textContent).not.toContain("Import jobsShowing");
    expect(container.textContent).not.toContain("Showing 2 of 3 import jobs");
    expect(container.textContent).not.toContain("Load more");

    await act(async () => root.unmount());
  });
});

function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    discoveredCount: 10,
    failureCount: 0,
    importJobId: "job-1",
    importedCount: 3,
    importKind: "metadata",
    queuedCount: 7,
    sourceId: "opencode-sessions",
    status: "running",
    updatedAt: "2026-06-25T12:00:00.000Z",
    ...overrides
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}
