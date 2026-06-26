import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AppButton } from "../AppButton";

describe("AppButton", () => {
  test("renders a default Masthead button with safe button semantics", () => {
    const html = renderToStaticMarkup(<AppButton>Refresh</AppButton>);

    expect(html).toContain('type="button"');
    expect(html).toContain('class="app-button app-button-default metal-control"');
    expect(html).toContain("Refresh");
  });

  test("renders primary, danger, quiet, and icon variants without changing dimensions through text wrappers", () => {
    const html = renderToStaticMarkup(
      <>
        <AppButton variant="primary">Sync all</AppButton>
        <AppButton variant="danger">Delete</AppButton>
        <AppButton variant="quiet">Cancel</AppButton>
        <AppButton variant="icon" aria-label="Compact grid">
          X
        </AppButton>
      </>
    );

    expect(html).toContain("app-button-primary");
    expect(html).toContain("app-button-danger");
    expect(html).toContain("app-button-quiet");
    expect(html).toContain("app-button-icon");
    expect(html).toContain('aria-label="Compact grid"');
    expect(html).not.toContain("layout-toggle-text");
  });

  test("preserves disabled state and caller class names", () => {
    const html = renderToStaticMarkup(
      <AppButton disabled className="settings-inline-action">
        Retry
      </AppButton>
    );

    expect(html).toContain("disabled");
    expect(html).toContain("settings-inline-action");
  });
});
