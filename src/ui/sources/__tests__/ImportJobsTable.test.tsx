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
            currentPath: "/home/tyler/.codex/sessions/2026/06/25/session.jsonl",
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
    expect(html).toContain("/home/tyler/.codex/sessions/2026/06/25/session.jsonl");
    expect(html).toContain("running");
    expect(html).toContain("Cancel");
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
    expect(html.match(/Retry/g)).toHaveLength(2);
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
            importJob({ importJobId: "failed-job", status: "failed" })
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

  test("renders a single import queue title without header metadata", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ImportJobsTable
          imports={[importJob({ importJobId: "newest-job" }), importJob({ importJobId: "older-job" })]}
        />
      );
    });

    expect(container.querySelector(".import-jobs-title")?.textContent).toBe("Import queue");
    expect(container.querySelector(".import-jobs-summary")).toBeNull();
    expect(container.textContent).not.toContain("Import jobsShowing");
    expect(container.textContent).not.toContain("Showing 2 of 3 import jobs");
    expect(container.textContent).not.toContain("Visible");
    expect(container.textContent).not.toContain("Total");
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
    sourceId: "codex-sessions",
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
