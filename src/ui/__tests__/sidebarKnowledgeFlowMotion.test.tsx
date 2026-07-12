// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow";
import { SidebarKnowledgeFlow } from "../SidebarKnowledgeFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const summary: KnowledgeFlowSummaryDto = {
  capturedSessions: 17,
  workbenchSessions: 6,
  publishedArtifacts: 11,
  automaticallyResolvedSessions: 4
};

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("SidebarKnowledgeFlow motion", () => {
  test("renders initial counters at rest and animates only changed values", async () => {
    await render(summary);

    expect(counter("Capture sessions").className).toContain("t-digit-group");
    expect(counter("Capture sessions").className).not.toContain("is-animating");

    await render({ ...summary, capturedSessions: 18 });

    expect(counter("Capture sessions").className).toContain("is-animating");
    expect(counter("Workbench").className).not.toContain("is-animating");
    expect(counter("Capture sessions").textContent).toBe("18");
  });
});

async function render(nextSummary: KnowledgeFlowSummaryDto): Promise<void> {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(<SidebarKnowledgeFlow summary={nextSummary} />));
}

function counter(label: string): HTMLElement {
  const row = Array.from(container?.querySelectorAll<HTMLElement>(".sidebar-knowledge-spine-row") ?? [])
    .find((candidate) => candidate.textContent?.includes(label));
  const value = row?.querySelector<HTMLElement>(".sidebar-knowledge-stage-value");
  if (!value) throw new Error(`Counter not found for ${label}`);
  return value;
}
