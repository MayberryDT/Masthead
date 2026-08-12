// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MastheadPagesConnectionSection } from "../MastheadPagesConnectionSection";

describe("MastheadPagesConnectionSection", () => {
  test("offers connect when disconnected", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesConnectionSection connection={{ status: "disconnected" }} onConnect={() => undefined} />
    );
    expect(html).toContain("Connect Masthead Pages");
    expect(html).toContain("Publish destination");
  });

  test("shows connected publisher details and disconnect", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesConnectionSection
        connection={{
          status: "connected",
          account: {
            protocolVersion: "masthead-pages-account-v1",
            accountId: "account-1",
            handle: "demo",
            publisherAccess: "publisher",
            defaultLogbookVisibility: "discoverable"
          }
        }}
        onDisconnect={() => undefined}
        onRefresh={() => undefined}
      />
    );
    expect(html).toContain("@demo");
    expect(html).toContain("Disconnect Masthead Pages");
  });

  test("explains desktop-only availability", () => {
    const html = renderToStaticMarkup(<MastheadPagesConnectionSection desktopAvailable={false} />);
    expect(html).toContain("desktop app only");
  });
});
