// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HistoryPanel } from "../HistoryPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

describe("HistoryPanel pagination", () => {
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  test("optimistically shows the target page skeleton immediately after clicking next", async () => {
    const onPageChange = vi.fn();
    await renderPanel(onPageChange);

    const nextButton = currentContainer().querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    expect(nextButton).not.toBeNull();

    await act(async () => {
      nextButton?.click();
    });

    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(currentContainer().textContent).toContain("Page 2 of 3");
    expect(currentContainer().textContent).toContain("Showing 51-100 of 125");
    expect(currentContainer().textContent).not.toContain("Loading Logbook page");
    expect(currentContainer().querySelector('[aria-label="Loading next Logbook page"]')).not.toBeNull();
    expect(currentContainer().querySelector(".logbook-page-loading")).not.toBeNull();
    expect(currentContainer().textContent).not.toContain("Session 1");
  });

  test("updates visible pagination before notifying the parent page change handler", async () => {
    const onPageChange = vi.fn(() => {
      expect(currentContainer().textContent).toContain("Page 2 of 3");
      expect(currentContainer().textContent).toContain("Showing 51-100 of 125");
      expect(currentContainer().querySelector(".logbook-page-loading")).not.toBeNull();
    });
    await renderPanel(onPageChange);

    const nextButton = currentContainer().querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    expect(nextButton).not.toBeNull();

    await act(async () => {
      nextButton?.click();
    });

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  test("starts page transition on pointer down before click", async () => {
    const onPageChange = vi.fn();
    await renderPanel(onPageChange);

    const nextButton = currentContainer().querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    expect(nextButton).not.toBeNull();

    await act(async () => {
      nextButton?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    });

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(currentContainer().textContent).toContain("Page 2 of 3");
    expect(currentContainer().querySelector(".logbook-page-loading")).not.toBeNull();
    expect(currentContainer().textContent).not.toContain("Session 1");
  });

  test("does not notify twice when pointer down is followed by click", async () => {
    const onPageChange = vi.fn();
    await renderPanel(onPageChange);

    const nextButton = currentContainer().querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    expect(nextButton).not.toBeNull();

    await act(async () => {
      nextButton?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      nextButton?.click();
    });

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

async function renderPanel(onPageChange: (pageIndex: number) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <HistoryPanel
        loadState={{
          state: "ready",
          sessions: Array.from({ length: 50 }, (_, index) => ({
            project: "Masthead",
            runtime: "codex",
            sessionId: `session-${index + 1}`,
            title: `Session ${index + 1}`
          })),
          total: 125
        }}
        loading={false}
        pageIndex={0}
        pageSize={50}
        query=""
        onPageChange={onPageChange}
        onQueryChange={() => undefined}
      />
    );
  });
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}
