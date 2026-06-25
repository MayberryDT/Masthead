import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityRightRail } from "../ObservabilityRightRail";

describe("ObservabilityRightRail", () => {
  test("does not render connector controls in the telemetry rail", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="now"
        summary={{ active: 1, needsAttention: 0, conflicts: 0, completed: 0, running: 1, idle: 0, needsAction: 0 }}
      />
    );

    expect(html).not.toContain("Connector");
    expect(html).not.toContain("Reconnect");
  });

  test("renders live session telemetry without fake model or token values by default", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="now"
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).toContain("Visible sessions");
    expect(html).toContain("16 open sessions");
    expect(html).toContain("Connected sources");
    expect(html).toContain("Session Mix");
    expect(html).toContain("24");
    expect(html).not.toContain("Total Tokens");
    expect(html).not.toContain("48.7M");
    expect(html).not.toContain("Top Models");
    expect(html).not.toContain("Tokens / Min");
    expect(html).not.toContain("12.4K");
    expect(html).not.toContain("gpt-5.5");
    expect(html).not.toContain("gpt-5.4");
    expect(html).not.toContain("Demo data");
    expect(html).not.toContain("Active Sessions");
  });

  test("hides for Logbook and Settings", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="logbook"
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).toBe("");
  });

  test("renders source and agent access context panels", () => {
    const sourcesHtml = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="sources"
        sourceCount={2}
        summary={{ active: 0, needsAttention: 0, conflicts: 0, completed: 0, running: 0, idle: 0, needsAction: 0 }}
      />
    );
    const agentAccessHtml = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="agent_access"
        summary={{ active: 0, needsAttention: 0, conflicts: 0, completed: 0, running: 0, idle: 0, needsAction: 0 }}
      />
    );

    expect(sourcesHtml).toContain("Adapter Health");
    expect(sourcesHtml).toContain("Sources");
    expect(sourcesHtml).toContain("2");
    expect(agentAccessHtml).toContain("MCP Access");
    expect(agentAccessHtml).toContain("Read-only");
    expect(agentAccessHtml).toContain("Blocked");
  });

  test("does not render toolbar controls in the context rail by default", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        activeSurface="now"
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).not.toContain("rail-controls");
    expect(html).not.toContain("24h");
  });
});
