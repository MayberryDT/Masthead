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

  test("renders startup action and log entries", () => {
    const html = renderToStaticMarkup(
      <ConnectionRecoveryPanel
        connection={{ state: "offline", error: "Failed to fetch" } as MastheadConnectionState}
        action={{ state: "starting", message: "Launching bundled collector" }}
        startupLog={[
          { id: "preflight", label: "Preflight", detail: "Checking local ports", state: "done" },
          { id: "daemon", label: "Daemon", detail: "Starting connector", state: "running" }
        ]}
        onRetry={noop}
        onStart={noop}
      />
    );

    expect(html).toContain("Collector startup");
    expect(html).toContain("Launching bundled collector");
    expect(html).toContain("Preflight");
    expect(html).toContain("Checking local ports");
    expect(html).toContain("Done");
    expect(html).toContain("Daemon");
    expect(html).toContain("Starting connector");
    expect(html).toContain("Running");
  });

  test("disables the start button while connector action is starting", () => {
    const html = renderToStaticMarkup(
      <ConnectionRecoveryPanel
        connection={{ state: "offline", error: "Failed to fetch" } as MastheadConnectionState}
        action={{ state: "starting", message: "Launching bundled collector" }}
        onRetry={noop}
        onStart={noop}
      />
    );

    expect(html).toContain("<button type=\"button\" class=\"app-button app-button-primary metal-control\" disabled=\"\">Start collector</button>");
    expect(html).toContain(">Check now</button>");
  });

  test("uses startup error copy even when the daemon health probe is ready", () => {
    const html = renderToStaticMarkup(
      <ConnectionRecoveryPanel
        connection={{ state: "ready", baseUrl: "http://127.0.0.1:17373", health: {}, writable: true } as MastheadConnectionState}
        action={{ state: "error", message: "Collector started, but live projection did not load." }}
        onRetry={noop}
        onStart={noop}
      />
    );

    expect(html).toContain("Masthead could not finish connecting");
    expect(html).toContain("Collector started, but live projection did not load.");
    expect(html).not.toContain("Masthead daemon is ready");
  });
});
