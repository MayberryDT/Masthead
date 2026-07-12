// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { WorkbenchActivityDto, WorkbenchQueueSessionDto } from "../../../shared/workbench";
import { WorkbenchPanel } from "../WorkbenchPanel";

describe("WorkbenchPanel live update motion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("marks only genuinely new sessions and activity after the initial render", () => {
    act(() => {
      root.render(<WorkbenchPanel sessions={[session("old")]} activity={[activity("old")]} />);
    });

    expect(sessionRow("old").classList.contains("is-new")).toBe(false);
    expect(activityItem("old").classList.contains("is-new")).toBe(false);

    act(() => {
      root.render(
        <WorkbenchPanel
          sessions={[session("new"), session("old")]}
          activity={[activity("new"), activity("old")]}
        />
      );
    });

    expect(sessionRow("new").classList.contains("is-new")).toBe(true);
    expect(sessionRow("old").classList.contains("is-new")).toBe(false);
    expect(activityItem("new").classList.contains("is-new")).toBe(true);
    expect(activityItem("old").classList.contains("is-new")).toBe(false);

    act(() => {
      root.render(
        <WorkbenchPanel
          sessions={[session("new"), session("old")]}
          activity={[activity("new"), activity("old")]}
        />
      );
    });

    expect(sessionRow("new").classList.contains("is-new")).toBe(false);
    expect(activityItem("new").classList.contains("is-new")).toBe(false);
  });

  test("does not treat an existing page as newly arrived when pagination changes", () => {
    act(() => {
      root.render(<WorkbenchPanel page={0} sessions={[session("page-one")]} />);
    });

    act(() => {
      root.render(<WorkbenchPanel page={1} sessions={[session("page-two")]} />);
    });

    expect(sessionRow("page-two").classList.contains("is-new")).toBe(false);

    act(() => {
      root.render(<WorkbenchPanel page={1} sessions={[session("incoming"), session("page-two")]} />);
    });

    expect(sessionRow("incoming").classList.contains("is-new")).toBe(true);
  });

  function sessionRow(id: string): HTMLElement {
    const title = `Session ${id}`;
    const row = Array.from(container.querySelectorAll<HTMLElement>(".workbench-session-table tbody tr"))
      .find((element) => element.textContent?.includes(title));
    if (!row) throw new Error(`Missing row for ${title}`);
    return row;
  }

  function activityItem(id: string): HTMLElement {
    const summary = `Activity ${id}`;
    const item = Array.from(container.querySelectorAll<HTMLElement>(".workbench-activity-item"))
      .find((element) => element.textContent?.includes(summary));
    if (!item) throw new Error(`Missing activity for ${summary}`);
    return item;
  }
});

function session(id: string): WorkbenchQueueSessionDto {
  return {
    activeClaim: undefined,
    adrStatus: "unknown",
    bugFixTraceStatus: "unknown",
    incidentTimelineStatus: "unknown",
    lastActivityAt: "2026-07-11T12:00:00.000Z",
    latestActivity: undefined,
    lifecycle: "ended",
    nextAction: "check_transcript",
    project: "Masthead",
    publicationStatus: "publish_path",
    qualityStatus: "unchecked",
    resolutionStatus: "in_progress",
    runbookStatus: "unknown",
    runtime: "codex",
    sessionDossierStatus: "missing",
    sessionEnrichmentStatus: "missing",
    sessionId: `session:${id}`,
    sessionPackageStatus: "missing",
    title: `Session ${id}`,
    transcriptStatus: "unchecked"
  };
}

function activity(id: string): WorkbenchActivityDto {
  return {
    activityId: `activity:${id}`,
    sessionId: `session:${id}`,
    eventType: "transcript_imported",
    eventAt: "2026-07-11T12:00:00.000Z",
    actorKind: "daemon",
    summary: `Activity ${id}`,
    details: {}
  };
}
