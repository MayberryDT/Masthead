// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SettingsStateDto } from "../../../app/daemonClient";
import { SettingsSurface } from "../../../app/surfaces/SettingsSurface";
import { OperationsPanel } from "../../OperationsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings surface", () => {
  test("renders one compact steel card with every settings group", () => {
    const html = renderToStaticMarkup(
      <SettingsSurface>
        <OperationsPanel
          dataSummary={settings.storage.dataSummary}
          deletionScopeKind="project"
          deletionScopeTarget="Masthead"
          motionDisabled={false}
          onMotionDisabledChange={() => undefined}
          settingsState={settings}
        />
      </SettingsSurface>
    );

    expect(html).toContain("settings-spine-card");
    expect(html).not.toContain("settings-spine-node");
    expect(html).not.toContain("Interface transitions");
    expect(html).not.toContain("Session attention signals");
    expect(html).not.toContain("settings-category-nav");
    expect(html).not.toContain('class="settings-pane"');
    expect(html).not.toContain('aria-label="Settings categories"');
    expect(html).toContain('class="settings-spine-sections"');
    expect(html).not.toContain('aria-label="Open Data"');
    expect(html).not.toContain('aria-label="Open Agent access"');
    expect(html).not.toContain('aria-label="Open Advanced"');
    expect(html).not.toContain('aria-label="Open Danger zone"');
    expect(html).toContain("Data");
    expect(html).toContain("Agent access");
    expect(html).toContain("Advanced");
    expect(html).toContain("Danger zone");

    const css = readFileSync("src/styles/settings.css", "utf8");
    expect(css).toMatch(/\.settings-spine-row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(css).toMatch(/\.settings-spine-card \.settings-toggle\s*\{[\s\S]*flex-direction: row-reverse;/);
  });

  test("renders General and grouped controls together without disclosure chrome", () => {
    const html = renderToStaticMarkup(
      <SettingsSurface>
        <OperationsPanel
          dataSummary={settings.storage.dataSummary}
          deletionScopeKind="project"
          deletionScopeTarget="Masthead"
          motionDisabled={false}
          onMotionDisabledChange={() => undefined}
          settingsState={settings}
        />
      </SettingsSurface>
    );

    expect(html).toContain("settings-workspace");
    expect(html).toContain("settings-spine-card");
    expect(html).not.toContain('aria-label="Settings categories"');
    expect(html).toContain('class="settings-spine-sections"');
    expect(html).not.toContain("settings-layout-priority-bay");
    expect(html).not.toContain("settings-priority-column");
    expect(html).not.toContain("Remote enrichment");
    expect(html).not.toContain("Provider connection");
    expect(html).not.toContain("Use remote LLM enrichment");
    expect(html).not.toContain("OpenAI");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("Paste API key");
    expect(html).not.toContain("Fast model name");
    expect(html).not.toContain("type=\"password\"");
    expect(html).not.toContain("Save provider");
    expect(html).not.toContain("sk-test-settings-secret");
    expect(html).toContain("Data");
    expect(html).not.toContain("Transcript import");
    expect(html).not.toContain("Redaction");
    expect(html).not.toContain("Codex hooks");
    expect(html).not.toContain("Install/repair hooks");
    expect(html).not.toContain("Test hooks");
    expect(html).not.toContain("Uninstall hooks");
    expect(html).not.toContain("Supported harnesses");
    expect(html).not.toContain("Onboarding");
    expect(html).not.toContain("Run onboarding again");
    expect(html).not.toContain("Setup wizard");
    expect(html).toContain("Agent access");
    expect(html).toContain("MCP server");
    expect(html).not.toContain("Refresh MCP");
    expect(html).toContain("MCP TOML");
    expect(html).toContain("MCP JSON");
    expect(html).not.toContain("Test MCP launch");
    expect(html).toContain("/home/tyler/.local/share/masthead/masthead.sqlite");
    expect(html).toContain("Export data");
    expect(html).toContain("Motion");
    expect(html).toContain("Enable motion");
    expect(html).toContain("settings-toggle checked");
    expect(html).toContain("Motion on");
    expect(html).toContain("checked=\"\"");
    expect(html).toContain("Advanced");
    expect(html).not.toContain("Retention classes");
    expect(html).not.toContain("Raw event rows");
    expect(html).not.toContain("<span>MCP audit rows</span>");
    expect(html).not.toContain("Codex integration");
    expect(html).not.toContain("Lifecycle hooks");
    expect(html).not.toContain("Current enrichments");
    expect(html).not.toContain("Health");
    expect(html).toContain("Copy configuration");
    expect(html).not.toContain("Other MCP clients");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("Can agents read Masthead?");
    expect(html).toContain("Agent access");
    expect(html).toContain("settings-toggle");
    expect(html).not.toContain("ops-card");
    expect(html).not.toContain("ghost-pill");
    expect(html).not.toContain("<select");
  });

  test("renders disabled motion as the off state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <OperationsPanel motionDisabled onMotionDisabledChange={() => undefined} settingsState={settings} />
      );
    });

    const motionInput = host.querySelector<HTMLInputElement>('input[aria-label="Enable motion"]');
    expect(motionInput?.checked).toBe(false);
    const motionLabel = motionInput?.closest("label.settings-toggle");
    expect(motionLabel?.className).not.toContain("checked");
    expect(motionLabel?.textContent).toContain("Motion off");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("shows direct General and Data controls in the same card", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OperationsPanel settingsState={settings} />);
    });

    const card = host.querySelector<HTMLElement>(".settings-spine-card");
    expect(card?.textContent).toContain("Motion");
    expect(card?.textContent).toContain("Session notifications");
    expect(card?.textContent).not.toContain("Turns off app animations");
    expect(card?.textContent).not.toContain("Desktop only");

    const detail = host.querySelector<HTMLElement>(".settings-spine-sections");
    expect(detail?.textContent).toContain("Database");
    expect(detail?.textContent).toContain("Open folder");
    expect(detail?.textContent).toContain("Export");
    expect(detail?.textContent).toContain("Export data");
    expect(detail?.textContent).toContain("Raw source copies");
    expect(detail?.textContent).toContain(
      "Deletes stored raw copies only; normalized records and original harness files remain."
    );
    expect(detail?.textContent).toContain("Data directory");
    expect(detail?.textContent).toContain("Database ID");
    expect(detail?.textContent).toContain("Runtime");
    expect(host.textContent).not.toContain("Run onboarding again");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("keeps every settings section visible without open and close controls", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OperationsPanel settingsState={settings} />);
    });

    const sections = host.querySelector<HTMLElement>(".settings-spine-sections");
    expect(sections?.textContent).toContain("Data");
    expect(sections?.textContent).toContain("Agent access");
    expect(sections?.textContent).toContain("Advanced");
    expect(sections?.textContent).toContain("Danger zone");
    expect(host.querySelector(".settings-spine-detail")).toBeNull();
    expect(host.querySelector('[aria-label^="Open "]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("compresses Agent access into three direct Settings rows", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => mcpResponse(input)));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OperationsPanel settingsState={settings} />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const panel = host.querySelector<HTMLElement>(".settings-spine-sections");
    expect(panel?.textContent).toContain("MCP server");
    expect(panel?.textContent).toContain("Test connection");
    expect(panel?.textContent).toContain("Access");
    expect(panel?.textContent).toContain("Client setup");
    expect(panel?.textContent).toContain("Copy configuration");
    expect(panel?.textContent).not.toContain("Checking the local MCP launch configuration");
    expect(panel?.textContent).not.toContain("Refresh MCP");
    expect(panel?.textContent).not.toContain("Test MCP launch");
    expect(panel?.textContent).not.toContain("Works for Claude Code");
    expect(panel?.textContent).not.toContain("Use when a client expects TOML");
    expect(panel?.textContent).not.toContain("Raw command, args, and environment");
    expect(panel?.querySelector("pre")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("switches to the compact Advanced identity pane", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OperationsPanel settingsState={settings} />);
    });

    const pane = host.querySelector<HTMLElement>(".settings-spine-sections");
    expect(pane?.textContent).toContain("Database ID");
    expect(pane?.textContent).toContain("/home/tyler/.local/share/masthead/masthead.sqlite");
    expect(pane?.textContent).toContain("127.0.0.1:17373");
    expect(pane?.textContent).toContain("API 1 / schema 5");
    expect(pane?.textContent).toContain("Delete all Masthead data");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("shortens the Data database path while preserving the full path as a title", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<OperationsPanel settingsState={settings} />);
    });

    const compactPath = host.querySelector<HTMLElement>(
      '[title="/home/tyler/.local/share/masthead/masthead.sqlite"]'
    );
    expect(compactPath?.textContent).toBe("…/masthead/masthead.sqlite");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("renders a separate confirmation dialog for destructive actions", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={settings.storage.dataSummary}
        localDataStatus={{
          action: "delete_all",
          state: "confirm_delete",
          message: "Confirm delete all Masthead data: 31 sessions and 7,657 raw source copies."
        }}
        settingsState={settings}
      />
    );

    expect(html).toContain("Danger zone");
    expect(html).toContain("Confirm delete all Masthead data");
    expect(html).toContain("sqlite:test");
    expect(html).toContain("31 sessions");
    expect(html).toContain("7,657 raw source copies");
    expect(html).toContain("Cancel");
    expect(html).toContain("Type sqlite:test to confirm");
    expect(html).toContain("Deletes Masthead");
  });

  test("delete-all confirmation requires typing the active database id", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={settings.storage.dataSummary}
        localDataStatus={{
          action: "delete_all",
          state: "confirm_delete",
          message: "Confirm delete all Masthead data: 31 sessions and 7,657 raw source copies."
        }}
        settingsState={settings}
      />
    );

    expect(html).toContain('placeholder="sqlite:test"');
    expect(html).toContain("Delete all Masthead data");
    expect(html).toContain("disabled=\"\"");
  });

  test("scoped deletion confirmation requires typing the selected target", () => {
    const html = renderToStaticMarkup(
      <OperationsPanel
        dataSummary={settings.storage.dataSummary}
        deletionScopeKind="project"
        deletionScopeTarget="Masthead"
        localDataStatus={{
          action: "scoped_delete",
          state: "confirm_scoped_delete",
          message: "Confirm scoped deletion for project Masthead: 31 sessions."
        }}
        settingsState={settings}
      />
    );

    expect(html).toContain("Type Masthead to confirm");
    expect(html).toContain("Delete selected records");
    expect(html).toContain("disabled=\"\"");
  });

  test("centers a responsive steel spine with real toggle styling", () => {
    const css = readFileSync("src/styles/settings.css", "utf8");

    expect(css).toMatch(/\.settings-workspace\s*\{[\s\S]*place-items: start center;[\s\S]*padding: clamp\(18px, 5vh, 56px\) 18px 28px;/);
    expect(css).toMatch(/\.settings-spine-card\s*\{[\s\S]*width: min\(100%, 680px\);[\s\S]*padding: 14px;/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.settings-workspace\s*\{[\s\S]*padding: 12px;[\s\S]*\.settings-row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.settings-row-copy,[\s\S]*\.settings-row-detail\s*\{[\s\S]*grid-column: 1;/);
    expect(css).toMatch(/@media \(max-width: 390px\) \{[\s\S]*\.settings-delete-controls\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*\.settings-row-control > \.app-button,[\s\S]*width: 100%;/);
    expect(css).toMatch(/\.settings-row-detail\s*\{[\s\S]*grid-column: 2;/);
    expect(css).toMatch(/\.settings-delete-controls input\s*\{[\s\S]*min-height: 40px;/);
    expect(css).toMatch(/\.confirm-dialog-typed input\s*\{[\s\S]*min-height: 40px;/);
    expect(css).toMatch(/\.settings-toggle > span\s*\{[\s\S]*width: 42px;[\s\S]*height: 24px;/);
    expect(css).toMatch(/\.settings-toggle\.checked > span::after\s*\{[\s\S]*transform: translateX\(20px\);/);
    expect(css).toMatch(/\.settings-mcp-setup\s*\{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;[\s\S]*gap: 8px;/);
    expect(css).toMatch(/\.settings-mcp-tabs button\s*\{[\s\S]*min-height: 40px;/);
    expect(css).toContain(".settings-mcp-inline-result");
    expect(css).not.toContain(".settings-mcp-summary");
    expect(css).not.toContain(".settings-section-mcp .code-block");
    expect(css).not.toContain(".settings-layout-priority-bay");
    expect(css).not.toContain(".settings-priority-column");
  });

  test("keeps Danger select labels visible over later global responsive rules", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    const settingsCss = readFileSync("src/styles/settings.css", "utf8");
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const labelSelector = ".settings-panel .settings-delete-controls .toolbar-select-trigger > span";
    const chevronSelector = ".settings-panel .settings-delete-controls .toolbar-select-chevron";

    expect(main.indexOf('import "./styles/settings.css"')).toBeLessThan(
      main.indexOf('import "./styles/masthead.css"')
    );
    expect(mastheadCss).toMatch(/@media \(min-width: 761px\) and \(max-width: 1040px\) \{[\s\S]*\.toolbar-select-trigger span,[\s\S]*\.toolbar-select-chevron,[\s\S]*display: none;/);
    expect(mastheadCss).toMatch(/@media \(min-width: 401px\) and \(max-width: 760px\) \{[\s\S]*\.toolbar-select-trigger span,[\s\S]*\.toolbar-select-chevron,[\s\S]*display: none;/);
    expect(settingsCss).toContain(`${labelSelector},\n${chevronSelector} {`);
    expect(settingsCss).toMatch(/\.settings-panel \.settings-delete-controls \.toolbar-select-trigger > span,[\s\S]*\.settings-panel \.settings-delete-controls \.toolbar-select-chevron\s*\{[\s\S]*display: block;/);
    expect(classSpecificity(labelSelector)).toBeGreaterThan(classSpecificity(".toolbar-select-trigger span"));
    expect(classSpecificity(chevronSelector)).toBeGreaterThan(classSpecificity(".toolbar-select-chevron"));
  });

  test("gives MCP tabs a visible keyboard focus ring", () => {
    const css = readFileSync("src/styles/settings.css", "utf8");
    const focusRule = [...css.matchAll(/\.settings-mcp-tabs button:focus-visible\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .find((rule) => rule.includes("box-shadow:"));

    expect(focusRule).toContain("outline: 0;");
    expect(focusRule).toContain("box-shadow:");
    expect(focusRule).toContain("0 0 0 1px rgba(116, 185, 224, 0.34),");
    expect(focusRule).toContain("0 0 0 3px rgba(46, 167, 255, 0.12);");
  });

  test("keeps the MCP focus ring authoritative for an active tab", () => {
    const css = readFileSync("src/styles/settings.css", "utf8");
    const activeSelector = ".settings-mcp-tabs button.active";
    const focusSelector = ".settings-mcp-tabs button:focus-visible";
    const activeRule = css.match(/\.settings-mcp-tabs button\.active\s*\{([^}]*)\}/)?.[1];
    const activeRuleIndex = css.indexOf(`${activeSelector} {`);
    const focusRingRuleIndex = css.indexOf(`${focusSelector} {\n  outline: 0;`);

    expect(stateSpecificity(focusSelector)).toBe(stateSpecificity(activeSelector));
    expect(activeRule).toContain("box-shadow: 0 0 0 1px rgba(112, 173, 205, 0.2);");
    expect(focusRingRuleIndex).toBeGreaterThan(activeRuleIndex);
  });

  test("keeps grouped spine sections flat inside the shared steel card", () => {
    const settingsCss = readFileSync("src/styles/settings.css", "utf8");
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");

    expect(settingsCss).toMatch(/\.settings-panel \.settings-spine-sections > \.settings-section\s*\{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*animation: none;[\s\S]*transition: none;/);
    expect(settingsCss).toMatch(/\.settings-panel \.settings-spine-sections > \.settings-section::before,[\s\S]*\.settings-panel \.settings-spine-sections > \.settings-section::after\s*\{[\s\S]*content: none;[\s\S]*display: none;/);
    expect(mastheadCss).toMatch(/\.observability-console \.settings-spine-card,[\s\S]*\.masthead-shell \.settings-spine-card,[\s\S]*border: 1px solid rgba\(92, 153, 187, 0\.14\);[\s\S]*background: #071b28;/);
    expect(mastheadCss).toMatch(/\.observability-console \.settings-section,[\s\S]*\.masthead-shell \.settings-section,[\s\S]*\.masthead-shell \.adapter-card\s*\{[\s\S]*border: 1px solid rgba\(92, 153, 187, 0\.14\);[\s\S]*border-radius: 5px;[\s\S]*background: #071b28;/);
    expect(mastheadCss).toMatch(/\.summary-strip \.summary-metric,[\s\S]*\.settings-section,[\s\S]*\.settings-spine-card,[\s\S]*\.connected-source-row,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: surface-card-enter 400ms cubic-bezier\(0\.17, 0\.78, 0\.13, 1\) both;[\s\S]*transform-origin: 50% 100%;/);
    expect(mastheadCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.settings-spine-card,[\s\S]*\.adapter-card\s*\{[\s\S]*animation: none;/);
    expect(settingsCss).not.toContain(".settings-spine-detail");
  });

  test("shares one accessible inline action-feedback primitive", () => {
    const storageSource = readFileSync("src/ui/settings/StorageSettings.tsx", "utf8");
    const mcpSource = readFileSync("src/ui/settings/McpSettings.tsx", "utf8");
    const dangerSource = readFileSync("src/ui/settings/DangerZone.tsx", "utf8");

    expect(storageSource).toContain('from "./SettingsActionFeedback"');
    expect(mcpSource).toContain('from "./SettingsActionFeedback"');
    expect(dangerSource).toContain('from "./SettingsActionFeedback"');
    expect(storageSource).not.toContain("<span className={`settings-inline-feedback");
    expect(mcpSource).not.toContain("<span className={`settings-inline-feedback");
  });
});

function classSpecificity(selector: string): number {
  return selector.match(/\.[a-z0-9_-]+/gi)?.length ?? 0;
}

function stateSpecificity(selector: string): number {
  return selector.match(/[.:][a-z0-9_-]+/gi)?.length ?? 0;
}

function mcpResponse(input: string | URL | Request): Response {
  const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
  if (pathname === "/mcp/status") {
    return jsonResponse({
      ok: true,
      status: {
        ready: true,
        databasePath: "/tmp/masthead.sqlite",
        mode: "stdio",
        readOnly: true,
        toolCount: 8,
        queryCount: 0,
        globalAccessEnabled: true
      }
    });
  }
  if (pathname === "/mcp/launch-config") {
    return jsonResponse({
      ok: true,
      launchConfig: {
        command: "/usr/bin/node",
        args: ["/app/dist/mcp/server.js"],
        env: { MASTHEAD_DB_PATH: "/tmp/masthead.sqlite" }
      }
    });
  }
  if (pathname === "/mcp/launch-config/validate") {
    return jsonResponse({
      ok: true,
      validation: { valid: true, commandExists: true, entryExists: true, databaseMatches: true, problems: [] }
    });
  }
  return jsonResponse({ ok: true });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const settings: SettingsStateDto = {
  apiVersion: 1,
  capabilities: ["settings"],
  schemaVersion: 5,
  data: {
    databaseId: "sqlite:test",
    databasePath: "/home/tyler/.local/share/masthead/masthead.sqlite",
    dataDirectory: "/home/tyler/.local/share/masthead",
    migrationState: "ready",
    storePath: "/home/tyler/.local/share/masthead/events.ndjson"
  },
  deletionTargets: {
    hosts: [{ label: "Veelox", value: "Veelox" }],
    projects: [{ label: "Masthead", value: "Masthead" }],
    runtimes: [{ label: "codex", value: "codex" }]
  },
  enrichment: {
    currentEnrichments: 31,
    health: {
      complete: 31,
      disabled: 0,
      failed: 0,
      queued: 0,
      status: "complete"
    },
    model: "deterministic",
    provider: "Deterministic fallback",
    remoteModelEnabled: false,
    sessionCount: 31
  },
  hooks: {
    command: "MASTHEAD_INGEST_URL=http://127.0.0.1:17373/ingest node /app/scripts/masthead-hook.js",
    configExists: true,
    configPath: "/home/tyler/.codex/hooks.json",
    endpoint: "http://127.0.0.1:17373/ingest",
    installed: true,
    integrations: [
      {
        actionSurface: "settings",
        captureMode: "live_hook",
        description: "Live local hook events are managed from this Settings card.",
        label: "Codex",
        runtime: "codex",
        status: "installed",
        supportsActions: true
      },
      {
        actionSurface: "sources",
        captureMode: "transcript_import",
        description: "Imported from local Claude Code transcript history through Sources.",
        label: "Claude Code",
        runtime: "claude_code",
        status: "managed_in_sources",
        supportsActions: false
      },
      {
        actionSurface: "sources",
        captureMode: "transcript_import",
        description: "Imported from local OpenCode transcript history through Sources.",
        label: "OpenCode",
        runtime: "opencode",
        status: "managed_in_sources",
        supportsActions: false
      }
    ],
    latestBackupPath: "/home/tyler/.codex/hooks.json.masthead-backup.json",
    lastEventAt: "2026-06-25T12:00:00.000Z",
    missingEvents: [],
    mismatchedEvents: []
  },
  llm: {
    activeProvider: "openai",
    providers: [
      {
        apiKeyRequired: true,
        apiStyle: "responses",
        baseUrl: "https://api.openai.com/v1",
        configured: false,
        customBaseUrl: false,
        id: "openai",
        label: "OpenAI",
        local: false,
        model: "gpt-5-nano-2025-08-07"
      },
      {
        apiKeyRequired: true,
        apiStyle: "chat_completions",
        configured: false,
        customBaseUrl: true,
        id: "openai_compatible",
        label: "OpenAI-compatible",
        local: false,
        model: ""
      },
      {
        apiKeyRequired: true,
        apiStyle: "anthropic_messages",
        configured: false,
        customBaseUrl: false,
        id: "anthropic",
        label: "Anthropic",
        local: false,
        model: "claude-sonnet-4-6"
      },
      {
        apiKeyRequired: true,
        apiStyle: "gemini_generate_content",
        configured: false,
        customBaseUrl: false,
        id: "gemini",
        label: "Gemini",
        local: false,
        model: "gemini-3.5-flash"
      }
    ],
    remoteEnrichmentEnabled: false,
    secretStorage: {
      description: "API keys are stored only in the local Masthead settings database and are never returned by the settings API.",
      kind: "local_database"
    }
  },
  product: "masthead",
  runtime: {
    host: "127.0.0.1",
    mode: "primary",
    port: 17373,
    writable: true
  },
  privacy: {
    mcpAccessEnabled: true,
    redactionEnabled: true,
    transcriptImportEnabled: true
  },
  storage: {
    dataSummary: {
      auditRows: 2,
      enrichments: 31,
      messages: 120,
      rawEvents: 7657,
      sessions: 31,
      sources: 4,
      storageClasses: {
        audit_logs: { description: "MCP query audit records.", records: 2, retention: "configurable" },
        canonical_metadata: { description: "Sessions and capsules.", records: 31, retention: "indefinite" },
        derived_indexes: { description: "Indexes.", records: 31, retention: "rebuildable" },
        large_outputs: { description: "Outputs.", records: 0, retention: "short_configurable" },
        raw_payloads: { description: "Raw payloads.", records: 7657, retention: "configurable" },
        searchable_messages: { description: "Messages.", records: 120, retention: "indefinite_configurable" }
      },
      tables: {
        mcp_query_log: 2,
        raw_events: 7657,
        session_search: 31,
        sessions: 31
      }
    },
    databasePath: "/home/tyler/.local/share/masthead/masthead.sqlite",
    dataDirectory: "/home/tyler/.local/share/masthead",
    storePath: "/home/tyler/.local/share/masthead/events.ndjson"
  }
};
