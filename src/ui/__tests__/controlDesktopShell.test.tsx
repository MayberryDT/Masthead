import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ControlDesktopShell } from "../ControlDesktopShell";

describe("ControlDesktopShell", () => {
  test("renders the three-pane control desktop landmarks", () => {
    const html = renderToStaticMarkup(
      <ControlDesktopShell
        rail={<p>Session rail</p>}
        center={<p>Ops scan</p>}
        inspector={<p>Technical inspector</p>}
      />
    );

    expect(html).toContain("Session rail");
    expect(html).toContain("Ops scan");
    expect(html).toContain("Technical inspector");
    expect(html).toContain('aria-label="Session navigation"');
    expect(html).toContain('aria-label="Operations scan"');
    expect(html).toContain('aria-label="Session inspector"');
  });
});
