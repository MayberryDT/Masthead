import { describe, expect, test } from "vitest";
import { detectHostRuntime, resolveHookRuntime } from "../resolveHookRuntime.ts";
import { runtimeFromAdapter } from "../liveIdentity.ts";

describe("resolveHookRuntime", () => {
  test("MASTHEAD_RUNTIME pin overrides ingest URL runtime", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_RUNTIME: "grok",
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code"
        },
        payload: {}
      })
    ).toBe("grok");
  });

  test("strong Grok dual-fire markers override URL claude_code", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code",
          GROK_HOOK_EVENT: "UserPromptSubmit",
          GROK_SESSION_ID: "019f42f6-8ada-7001-afff-c722e75faf45"
        },
        payload: {}
      })
    ).toBe("grok");
  });

  test("strong Grok dual-fire markers override Claude MASTHEAD_RUNTIME pin (dual-fire after reinstall)", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_RUNTIME: "claude_code",
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code",
          GROK_HOOK_EVENT: "UserPromptSubmit",
          GROK_SESSION_ID: "sess-1"
        },
        payload: {}
      })
    ).toBe("grok");
  });

  test("ambient GROK_AGENT does not steal Codex pin or URL", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_RUNTIME: "codex",
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=codex",
          GROK_AGENT: "1"
        },
        payload: {}
      })
    ).toBe("codex");

    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=codex",
          GROK_AGENT: "1",
          GROK_HOME: "/home/user/.grok"
        },
        payload: {}
      })
    ).toBe("codex");
  });

  test("ambient GROK_AGENT does not steal unpinned Claude URL", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code",
          GROK_AGENT: "1"
        },
        payload: {}
      })
    ).toBe("claude_code");
  });

  test("pin is used when host is unknown", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_RUNTIME: "grok",
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code"
        },
        payload: {}
      })
    ).toBe("grok");
  });

  test("matching pin and Claude weak markers stay on that runtime", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_RUNTIME: "claude_code",
          CLAUDE_PROJECT_DIR: "/workspace/masthead"
        },
        payload: {}
      })
    ).toBe("claude_code");
  });

  test("Claude host markers with URL claude_code stay claude_code", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=claude_code",
          CLAUDE_PROJECT_DIR: "/workspace/masthead"
        },
        payload: {}
      })
    ).toBe("claude_code");
  });

  test("falls back to ingest URL runtime when host is ambiguous", () => {
    expect(
      resolveHookRuntime({
        env: {
          MASTHEAD_INGEST_URL: "http://127.0.0.1:17373/ingest?runtime=opencode"
        },
        payload: { runtime: "claude_code" }
      })
    ).toBe("opencode");
  });

  test("falls back to payload runtime/adapter when env and host are empty", () => {
    expect(
      resolveHookRuntime({
        env: {},
        payload: { adapter: "hermes" }
      })
    ).toBe("hermes");
  });

  test("strong Grok dual-fire markers beat Claude markers when both present", () => {
    expect(
      detectHostRuntime({
        GROK_HOOK_EVENT: "PreToolUse",
        GROK_SESSION_ID: "sess-1",
        CLAUDE_PROJECT_DIR: "/workspace/masthead",
        CLAUDE_CODE_SUBAGENT_MODEL: "openrouter/free"
      })
    ).toBe("grok");
  });

  test("ambient GROK_AGENT alone is not host detection", () => {
    expect(detectHostRuntime({ GROK_AGENT: "1", GROK_HOME: "/tmp/.grok" })).toBeUndefined();
  });

  test("does not treat substring path or argv tokens as host markers", () => {
    expect(
      detectHostRuntime({}, {
        processPath: "/home/user/.local/bin/my-codex-helper",
        argv: ["node", "/tmp/encode-text.js"]
      })
    ).toBeUndefined();
    expect(
      detectHostRuntime({}, {
        processPath: "/usr/bin/codex",
        argv: ["codex"]
      })
    ).toBe("codex");
  });
});

describe("runtimeFromAdapter live runtimes", () => {
  test("accepts codex compat runtime", () => {
    expect(runtimeFromAdapter("codex")).toBe("codex");
  });

  test("accepts grok live runtime", () => {
    expect(runtimeFromAdapter("grok")).toBe("grok");
  });
});
