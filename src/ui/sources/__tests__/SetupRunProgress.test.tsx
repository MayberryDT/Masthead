import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SetupRunProgress } from "../SetupRunProgress";

describe("SetupRunProgress", () => {
  test("shows a dossier-style spinner on running setup tasks only", () => {
    const html = renderToStaticMarkup(
      <SetupRunProgress
        logs={[
          {
            id: "live:opencode:install",
            label: "Install OpenCode live capture",
            message: "Running...",
            status: "running",
            timestamp: "2026-07-05T01:53:59.571Z"
          },
          {
            id: "sources:setup",
            label: "Import selected metadata",
            message: "Complete.",
            status: "succeeded",
            timestamp: "2026-07-05T01:54:01.355Z"
          }
        ]}
      />
    );

    expect(html).toContain("setup-run-spinner");
    expect(html.match(/setup-run-spinner/g)).toHaveLength(1);
    expect(html).toContain("Install OpenCode live capture");
    expect(html).toContain("Import selected metadata");
  });

  test("does not animate historical running log rows once a report exists", () => {
    const html = renderToStaticMarkup(
      <SetupRunProgress
        report={{ status: "needs_attention", steps: [] }}
        logs={[
          {
            id: "live:opencode:install",
            label: "Install OpenCode live capture",
            message: "Running...",
            status: "running",
            timestamp: "2026-07-05T01:53:59.571Z"
          }
        ]}
      />
    );

    expect(html).not.toContain("setup-run-spinner");
    expect(html).toContain("needs attention");
  });

  test("shows only the latest state for each setup task", () => {
    const html = renderToStaticMarkup(
      <SetupRunProgress
        report={{ status: "needs_attention", steps: [] }}
        logs={[
          {
            id: "live:opencode:install",
            label: "Install OpenCode live capture",
            message: "Running...",
            status: "running",
            timestamp: "2026-07-05T02:18:07.067Z"
          },
          {
            id: "live:opencode:install",
            label: "Install OpenCode live capture",
            message: "Complete.",
            status: "succeeded",
            timestamp: "2026-07-05T02:18:07.281Z"
          },
          {
            id: "live:cursor",
            label: "Cursor live capture",
            message: "Live capture is required but this harness does not have a writable adapter yet.",
            status: "failed",
            timestamp: "2026-07-05T02:18:07.281Z"
          },
          {
            id: "sources:setup",
            label: "Import selected metadata",
            message: "Running...",
            status: "running",
            timestamp: "2026-07-05T02:18:07.281Z"
          },
          {
            id: "sources:setup",
            label: "Import selected metadata",
            message: "Complete.",
            status: "succeeded",
            timestamp: "2026-07-05T02:18:08.519Z"
          }
        ]}
      />
    );

    expect(html.match(/Install OpenCode live capture/g)).toHaveLength(1);
    expect(html.match(/Import selected metadata/g)).toHaveLength(1);
    expect(html).not.toContain("Running...");
    expect(html).toContain("Cursor live capture");
    expect(html).toContain("succeeded");
    expect(html).toContain("failed");
  });
});
