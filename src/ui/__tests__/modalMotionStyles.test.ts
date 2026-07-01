import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const mastheadCss = readFileSync(new URL("../../styles/masthead.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = mastheadCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("modal motion styles", () => {
  test("uses the selected Counterweighted Hinge motion for session detail modals", () => {
    expect(cssRule(":root")).toMatch(/--modal-open-dur:\s*300ms;/);
    expect(cssRule(":root")).toMatch(/--modal-close-dur:\s*300ms;/);
    expect(cssRule(".session-detail-modal.t-modal")).toMatch(/transform-origin:\s*50%\s+0%;/);
    expect(cssRule(".session-detail-modal.t-modal.is-open")).toMatch(
      /animation:\s*counterweight-hinge-in\s+var\(--modal-open-dur\)\s+var\(--modal-ease\)\s+both;/
    );
    expect(cssRule(".session-detail-modal.t-modal.is-closing")).toMatch(
      /animation:\s*counterweight-hinge-out\s+var\(--modal-close-dur\)\s+cubic-bezier\(0\.48,\s*0,\s*0\.82,\s*0\.28\)\s+both;/
    );
    expect(cssRule(".t-modal-backdrop.is-closing")).toMatch(
      /animation:\s*modal-backdrop-out\s+var\(--modal-close-dur\)\s+linear\s+both;/
    );
    expect(mastheadCss).toContain("@keyframes counterweight-hinge-in");
    expect(mastheadCss).toContain("@keyframes counterweight-hinge-out");
    expect(mastheadCss).toContain("rotateX(-68deg)");
    expect(mastheadCss).toContain("rotateX(-54deg)");
  });

  test("disables modal keyframe animations when reduced motion is requested", () => {
    expect(mastheadCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.t-dropdown,\s*[\s\S]*\.t-modal,\s*[\s\S]*\.t-modal-backdrop\s*\{[\s\S]*animation:\s*none !important;/
    );
  });
});
