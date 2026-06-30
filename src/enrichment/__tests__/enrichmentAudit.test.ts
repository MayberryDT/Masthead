import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEnrichmentAuditLogger, sanitizeEnrichmentAuditValue } from "../enrichmentAudit.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment audit logging", () => {
  test("disabled logger writes nothing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-audit-"));
    tempDirs.push(tempDir);
    const auditFile = join(tempDir, "audit.jsonl");
    const logger = createEnrichmentAuditLogger({
      MASTHEAD_ENRICHMENT_AUDIT_FILE: auditFile
    });

    logger.record({ kind: "durable.started", sessionId: "session-1" });

    await expect(readFile(auditFile, "utf8")).rejects.toThrow();
    expect(logger.enabled).toBe(false);
  });

  test("enabled logger writes redacted JSONL events", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-audit-"));
    tempDirs.push(tempDir);
    const auditFile = join(tempDir, "audit.jsonl");
    const logger = createEnrichmentAuditLogger({
      MASTHEAD_ENRICHMENT_AUDIT: "1",
      MASTHEAD_ENRICHMENT_AUDIT_FILE: auditFile,
      MASTHEAD_ENRICHMENT_AUDIT_INCLUDE_TEXT: "1",
      MASTHEAD_ENRICHMENT_AUDIT_MAX_TEXT: "24"
    });

    logger.record({
      details: {
        command: "npm test",
        firstPrompt: "Fix /home/tyler/private/project with OPENAI_API_KEY=sk-secret and https://example.com/callback",
        output: "x".repeat(80),
        password: "super-secret"
      },
      kind: "durable.facts",
      provider: "openai",
      sessionId: "session-1"
    });

    const lines = (await readFile(auditFile, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(event).toMatchObject({
      kind: "durable.facts",
      provider: "openai",
      sessionId: "session-1"
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("/home/tyler");
    expect(serialized).not.toContain("https://example.com");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).toContain("[redacted-secret]");
    expect(serialized).toContain("[redacted-path]");
    expect(serialized).toContain("[truncated]");
  });

  test("provider payload is omitted unless explicitly enabled", () => {
    expect(
      sanitizeEnrichmentAuditValue(
        {
          requestPayload: { input: "model input" },
          safe: "kept"
        },
        { includeProviderPayload: false, includeText: true, maxText: 100 }
      )
    ).toEqual({
      requestPayload: "[provider-payload-redacted]",
      safe: "kept"
    });
  });

  test("errors serialize safely", () => {
    const sanitized = sanitizeEnrichmentAuditValue(new Error("OPENAI_API_KEY sk-secret"), {
      includeProviderPayload: false,
      includeText: true,
      maxText: 100
    });

    expect(sanitized).toMatchObject({
      message: expect.stringContaining("[redacted-secret]"),
      name: "Error"
    });
  });
});
