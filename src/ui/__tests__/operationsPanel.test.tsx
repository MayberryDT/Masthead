import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OperationsPanel } from "../OperationsPanel";

describe("OperationsPanel", () => {
  test("renders local export and delete controls", () => {
    const html = renderToStaticMarkup(<OperationsPanel />);

    expect(html).toContain("Export local data");
    expect(html).toContain("Apply retention");
    expect(html).toContain("Delete Masthead data");
    expect(html).toContain("Manual 30-day prune");
    expect(html).toContain("Pinned records and unresolved attention stay until delete");
    expect(html).toContain("Clears Masthead app-store and live collector history only");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
  });

  test("renders explicit delete confirmation state", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        localDataStatus={{
          state: "confirm_delete",
          message: "Confirm deletion to remove Masthead app-store and live collector history."
        }}
      />
    );

    expect(html).toContain("Confirm delete");
    expect(html).toContain("Confirm deletion to remove Masthead app-store and live collector history.");
  });

  test("renders explicit retention confirmation state", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        localDataStatus={{
          state: "confirm_prune",
          message: "Confirm retention to prune Masthead-local history older than 30 days."
        }}
      />
    );

    expect(html).toContain("Confirm retention");
    expect(html).toContain("Confirm retention to prune Masthead-local history older than 30 days.");
  });

  test("renders local action errors without changing action labels", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel localDataStatus={{ state: "error", message: "Export failed: unavailable" }} />
    );

    expect(html).toContain("Export failed: unavailable");
    expect(html).toContain("Export local data");
    expect(html).toContain("Delete Masthead data");
  });
});
