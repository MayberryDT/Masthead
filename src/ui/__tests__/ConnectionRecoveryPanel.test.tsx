import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MastheadConnectionState } from "../../app/connection/MastheadConnectionProvider";
import { ConnectionRecoveryPanel } from "../ConnectionRecoveryPanel";

const noop = () => undefined;

describe("ConnectionRecoveryPanel", () => {
  test("renders incompatible daemon recovery copy", () => {
    const html = renderToStaticMarkup(
      <ConnectionRecoveryPanel
        connection={{ state: "incompatible", error: "legacy /health payload" } as MastheadConnectionState}
        onRetry={noop}
        onStart={noop}
      />
    );

    expect(html).toContain("Legacy daemon detected");
    expect(html).toContain("older collector");
    expect(html).toContain("Start compatible collector");
    expect(html).toContain("legacy /health payload");
  });

  test("renders offline recovery copy", () => {
    const html = renderToStaticMarkup(
      <ConnectionRecoveryPanel
        connection={{ state: "offline", error: "Failed to fetch" } as MastheadConnectionState}
        onRetry={noop}
        onStart={noop}
      />
    );

    expect(html).toContain("No Masthead daemon is responding");
    expect(html).toContain("local projection endpoint is unreachable");
    expect(html).toContain("Start collector");
    expect(html).toContain("Failed to fetch");
  });
});
