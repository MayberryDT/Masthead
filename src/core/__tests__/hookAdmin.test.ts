import { describe, expect, test } from "vitest";
import {
  installMastheadHookConfig,
  uninstallMastheadHookConfig,
  verifyMastheadHookConfig
} from "../hookAdmin";

const command = "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js";

describe("Codex hook admin config", () => {
  test("installs official matcher-group hook entries without removing existing groups", () => {
    const existing = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume",
            hooks: [{ type: "command" as const, command: "node existing.js", statusMessage: "Existing" }]
          }
        ]
      }
    };

    const next = installMastheadHookConfig(existing, { command, timeout: 2 });

    expect(next.hooks.SessionStart).toEqual([
      {
        matcher: "startup|resume",
        hooks: [{ type: "command", command: "node existing.js", statusMessage: "Existing" }]
      },
      { matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }
    ]);
    expect(next.hooks.PermissionRequest).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.PostToolUse).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.Stop).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
  });

  test("install is idempotent", () => {
    const once = installMastheadHookConfig({}, { command });
    const twice = installMastheadHookConfig(once, { command });

    expect(twice).toEqual(once);
  });

  test("uninstalls only Masthead hook handlers and preserves non-Masthead groups", () => {
    const installed = installMastheadHookConfig(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "node existing.js" }]
            }
          ]
        }
      },
      { command }
    );

    const next = uninstallMastheadHookConfig(installed);

    expect(next.hooks.SessionStart).toEqual([{ matcher: "startup", hooks: [{ type: "command", command: "node existing.js" }] }]);
    expect(next.hooks.PermissionRequest).toEqual([]);
  });

  test("preserves malformed or legacy unknown groups instead of silently dropping them", () => {
    const legacy = {
      hooks: {
        SessionStart: [{ command: "node legacy-flat.js", name: "legacy" } as never]
      }
    };

    const next = uninstallMastheadHookConfig(legacy);

    expect(next.hooks.SessionStart).toEqual([{ command: "node legacy-flat.js", name: "legacy" }]);
  });

  test("verification reports missing events", () => {
    const partial = installMastheadHookConfig({}, { command });
    partial.hooks.Stop = [];

    expect(verifyMastheadHookConfig(partial)).toEqual({
      installed: false,
      missingEvents: ["Stop"],
      mismatchedEvents: []
    });
  });

  test("verification reports hook command mismatches", () => {
    const installed = installMastheadHookConfig({}, { command: "node /app/scripts/masthead-hook.js" });

    expect(verifyMastheadHookConfig(installed, { command })).toEqual({
      installed: false,
      missingEvents: [],
      mismatchedEvents: ["SessionStart", "PermissionRequest", "PostToolUse", "Stop"]
    });
  });
});
