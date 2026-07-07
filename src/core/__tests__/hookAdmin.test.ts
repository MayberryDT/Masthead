import { describe, expect, test } from "vitest";
import {
  installMastheadHookConfig,
  uninstallMastheadHookConfig,
  verifyMastheadHookConfig
} from "../hookAdmin";

const command = "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest?runtime=codex node /app/scripts/masthead-hook.js";
const claudeStyleEvents = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop"] as const;

describe("Codex hook admin config", () => {
  test("installs official matcher-group hook entries for the Claude-style Codex event set without removing existing groups", () => {
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

    expect(Object.keys(next.hooks)).toEqual(claudeStyleEvents);
    expect(next.hooks.SessionStart).toEqual([
      {
        matcher: "startup|resume",
        hooks: [{ type: "command", command: "node existing.js", statusMessage: "Existing" }]
      },
      { matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }
    ]);
    expect(next.hooks.UserPromptSubmit).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.PermissionRequest).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.PreToolUse).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.PostToolUse).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
    expect(next.hooks.Stop).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
  });

  test("install is idempotent", () => {
    const once = installMastheadHookConfig({}, { command });
    const twice = installMastheadHookConfig(once, { command });

    expect(twice).toEqual(once);
  });

  test("install repairs stale Masthead hook commands", () => {
    const stale = installMastheadHookConfig({}, { command: "node /old/scripts/masthead-hook.js" });

    const next = installMastheadHookConfig(stale, { command, timeout: 2 });

    expect(verifyMastheadHookConfig(next, { command, timeout: 2 })).toEqual({
      installed: true,
      missingEvents: [],
      mismatchedEvents: []
    });
    expect(next.hooks.SessionStart).toEqual([{ matcher: "*", hooks: [{ type: "command", command, timeout: 2 }] }]);
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

  test("verification treats UserPromptSubmit and PreToolUse as required Codex hook events", () => {
    const partial = installMastheadHookConfig({}, { command });
    partial.hooks.UserPromptSubmit = [];
    partial.hooks.PreToolUse = [];

    expect(verifyMastheadHookConfig(partial)).toEqual({
      installed: false,
      missingEvents: ["UserPromptSubmit", "PreToolUse"],
      mismatchedEvents: []
    });
  });

  test("verification reports hook command mismatches", () => {
    const installed = installMastheadHookConfig({}, { command: "node /app/scripts/masthead-hook.js" });

    expect(verifyMastheadHookConfig(installed, { command })).toEqual({
      installed: false,
      missingEvents: [],
      mismatchedEvents: ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PreToolUse", "PostToolUse", "Stop"]
    });
  });
});
