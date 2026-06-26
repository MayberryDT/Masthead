import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AppSelect } from "../AppSelect";

describe("AppSelect", () => {
  test("renders the closed Now dropdown trigger as a reusable primitive", () => {
    const html = renderToStaticMarkup(
      <AppSelect
        label="Harnesses"
        icon="harness"
        value="all"
        options={[
          { value: "all", label: "All Harnesses" },
          { value: "codex", label: "Codex" }
        ]}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('class="toolbar-select metal-control');
    expect(html).toContain('class="toolbar-select-trigger"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    expect(html).toContain("All Harnesses");
  });

  test("preserves width modifier classes for toolbar parity", () => {
    const html = renderToStaticMarkup(
      <AppSelect
        label="Refresh rate"
        icon="refreshInterval"
        value="10000"
        className="refresh"
        options={[{ value: "10000", label: "10s" }]}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('class="toolbar-select metal-control  refresh"');
  });
});
