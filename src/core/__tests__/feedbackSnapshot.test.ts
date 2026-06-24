import { describe, expect, test } from "vitest";
import { buildLatestFeedbackSnapshot } from "../feedbackSnapshot";

describe("latest feedback snapshot", () => {
  test("summarizes assistant feedback without storing raw code, commands, paths, urls, filenames, or secrets", () => {
    const snapshot = buildLatestFeedbackSnapshot(
      [
        "Implemented src/lib/auth/session.ts and ran npm test -- --run src/core/__tests__/auth.test.ts.",
        "```ts",
        "const token = 'sk-test-secret';",
        "```",
        "OAuth tests are still failing at https://example.test/private.",
        "Checked /workspace/app/src/secret.ts with OPENAI_API_KEY=sk-test and node scripts/private.js."
      ].join("\n"),
      { observedAt: "2026-06-23T02:14:00.000Z" }
    );

    expect(snapshot).toMatchObject({
      source: "stop_hook",
      observedAt: "2026-06-23T02:14:00.000Z",
      redacted: true
    });
    expect(snapshot?.text).toContain("tests are still failing");
    expect(snapshot?.claims).toContain("mentions_tests");
    expect(snapshot?.claims).toContain("mentions_error");
    expect(snapshot?.claims).toContain("mentions_files");
    expect(snapshot?.text).not.toContain("src/lib/auth/session.ts");
    expect(snapshot?.text).not.toContain("src/");
    expect(snapshot?.text).not.toContain(".ts");
    expect(snapshot?.text).not.toContain("npm");
    expect(snapshot?.text).not.toContain("node");
    expect(snapshot?.text).not.toContain("OPENAI_API_KEY");
    expect(snapshot?.text).not.toContain("sk-test");
    expect(snapshot?.text).not.toContain("https://example.test");
    expect(snapshot?.text).not.toContain("/workspace");
    expect(snapshot?.text).not.toContain("```");
    expect(snapshot?.text.length).toBeLessThanOrEqual(400);
  });

  test("detects completion claims without treating them as completion", () => {
    const snapshot = buildLatestFeedbackSnapshot("All set. Implementation is complete, but I did not run tests.", {
      observedAt: "2026-06-23T02:20:00.000Z"
    });

    expect(snapshot?.claims).toContain("claims_complete");
    expect(snapshot?.claims).toContain("mentions_tests");
    expect(snapshot?.text).toContain("Implementation is complete");
  });

  test("omits non-operational assistant text instead of storing raw feedback", () => {
    expect(
      buildLatestFeedbackSnapshot("private assistant response that should not be stored", {
        observedAt: "2026-06-23T02:21:00.000Z"
      })
    ).toBeUndefined();
  });
});
