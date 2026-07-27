import { describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { buildMastheadHealth } from "../healthService.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

describe("buildMastheadHealth", () => {
  test("uses bounded live counts instead of table counts", () => {
    const database = {
      prepare(sql: string) {
        if (sql.includes("COUNT(")) throw new Error(`unexpected count query: ${sql}`);
        return {
          get() {
            return { value: JSON.stringify({ databaseId: "test-database-id" }) };
          }
        };
      }
    } as unknown as MastheadDatabase;
    const config = {
      allowedOrigins: ["http://127.0.0.1:5173"],
      codexHomeDir: "/tmp/masthead-test",
      dataDirectory: "/tmp/masthead-test",
      databasePath: "/tmp/masthead-test/masthead.sqlite",
      fixturePath: "/tmp/masthead-test/fixture.json",
      gitRefreshMs: 0,
      host: "127.0.0.1",
      hookTranscriptCatchupEnabled: false,
      llmCopyEnabled: false,
      port: 17373,
      storePath: "/tmp/masthead-test/events.ndjson"
    } satisfies DaemonConfig;

    const health = buildMastheadHealth(
      config,
      database,
      {
        authoringCommand: "/tmp/masthead/bin/mastheadctl",
        baseUrl: () => "http://127.0.0.1:17373",
        instanceDir: "/tmp/masthead",
        daemonInstanceId: "daemon-test-id",
        instanceManifest: "/tmp/masthead/masthead-instance.json",
        pid: 12345,
        port: () => 17373,
        startedAt: "2026-06-29T00:00:00.000Z"
      },
      {
        diagnostics: 2,
        events: 10,
        gitSnapshots: 4,
        sessions: 3,
        sources: 0
      }
    );

    expect(health.runtime.hookTranscriptCatchupEnabled).toBe(false);
    expect(health.runtime.authoringContractVersion).toBe("workbench-authoring-v5");
    expect(health.capabilities).toContain("artifact_authoring");
    expect(health.data.sessions).toBe(3);
    expect(health.data.sources).toBe(0);
  });
});
