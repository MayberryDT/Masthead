import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { DiscoveredSource } from "../../../adapters/types.ts";
import { planTranscriptImportUnits, transcriptPlanForWorkUnit } from "../transcriptImportPlanner.ts";

const source = (path?: string): DiscoveredSource => ({
  confidence: "authoritative",
  path,
  runtime: "hermes",
  sourceId: "planner-test:hermes",
  sourceKind: "jsonl"
});

describe("transcript import planning", () => {
  test("fails closed when adapter planning produces no units", async () => {
    await expect(planTranscriptImportUnits([source()])).rejects.toThrow("adapter produced no import units");
  });

  test("preserves a generic unit only when the adapter explicitly plans it", async () => {
    await expect(planTranscriptImportUnits([source("/tmp/masthead-explicit-missing-hermes.jsonl")])).resolves.toMatchObject([
      { timestampBasis: "unknown", unitId: "/tmp/masthead-explicit-missing-hermes.jsonl" }
    ]);
  });

  test("fails closed when a ledger unit has no exact planned unit", () => {
    expect(() =>
      transcriptPlanForWorkUnit([], {
        runtime: "hermes",
        sourcePath: "/tmp/unplanned.jsonl",
        workUnitId: "unit:unplanned"
      })
    ).toThrow("expected one planned unit, found 0");
  });

  test("deduplicates Grok auxiliary source plans under the canonical conversation unit", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-planner-"));
    const conversationId = "019f42f6-8ada-7001-afff-c722e75faf45";
    const conversationDir = join(root, conversationId);
    await mkdir(conversationDir, { recursive: true });
    await writeFile(join(conversationDir, "chat_history.jsonl"), `${JSON.stringify({ role: "user", content: "One conversation", timestamp: "2026-07-15T12:00:00.000Z" })}\n`);
    await writeFile(join(conversationDir, "updates.jsonl"), `${JSON.stringify({ status: "complete" })}\n`);
    await writeFile(join(conversationDir, "feedback.jsonl"), `${JSON.stringify({ score: 1 })}\n`);
    const sources = ["updates.jsonl", "feedback.jsonl", "chat_history.jsonl"].map((file) => ({
      confidence: "authoritative" as const,
      path: join(conversationDir, file),
      runtime: "grok" as const,
      sourceId: `planner-test:grok:${file}`,
      sourceKind: "jsonl" as const
    }));

    try {
      const plans = await planTranscriptImportUnits(sources);

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({
        source: {
          path: join(conversationDir, "chat_history.jsonl"),
          sourceId: "planner-test:grok:chat_history.jsonl"
        },
        sourceSessionId: conversationId,
        unitId: `grok:${conversationId}`
      });
      expect(
        transcriptPlanForWorkUnit(plans, {
          runtime: "grok",
          sourcePath: join(conversationDir, "chat_history.jsonl"),
          sourceSessionId: conversationId,
          workUnitId: "unit:grok"
        })
      ).toBe(plans[0]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
