import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityConsoleShell } from "../ObservabilityConsoleShell";

describe("ObservabilityConsoleShell", () => {
  test("renders session manager shell landmarks", () => {
    const html = renderToStaticMarkup(
      <ObservabilityConsoleShell
        sidebar={<p>Sidebar</p>}
        main={<p>Main workspace</p>}
      />
    );

    expect(html).toContain('aria-label="Masthead session manager"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Session workspace"');
    expect(html).toContain("masthead-shell");
    expect(html).toContain("masthead-sidebar");
    expect(html).not.toContain("metal-sidebar");
    expect(html).toContain("masthead-workspace");
    expect(html).toContain("masthead-content");
    expect(html).not.toContain("masthead-right-rail");
    expect(html).not.toContain("observability-topbar");
  });
});
