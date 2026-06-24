import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityConsoleShell } from "../ObservabilityConsoleShell";

describe("ObservabilityConsoleShell", () => {
  test("renders screenshot-style console landmarks", () => {
    const html = renderToStaticMarkup(
      <ObservabilityConsoleShell
        sidebar={<p>Sidebar</p>}
        main={<p>Main board</p>}
        rightRail={<p>Telemetry rail</p>}
      />
    );

    expect(html).toContain('aria-label="Masthead observability console"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Session observability board"');
    expect(html).toContain('aria-label="Telemetry panels"');
    expect(html).toContain("observability-console");
    expect(html).toContain("observability-sidebar");
    expect(html).toContain("observability-workspace");
    expect(html).toContain("observability-content");
    expect(html).toContain("observability-right-rail");
    expect(html).not.toContain("observability-topbar");
  });
});
