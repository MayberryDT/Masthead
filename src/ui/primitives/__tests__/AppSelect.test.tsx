import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AppSelect } from "../AppSelect";

describe("AppSelect", () => {
  test("renders the Now dropdown structure as a reusable primitive", () => {
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
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("All Harnesses");
    expect(html).toContain("Codex");
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
