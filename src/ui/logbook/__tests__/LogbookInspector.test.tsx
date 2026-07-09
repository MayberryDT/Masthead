import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LogbookInspector } from "../LogbookInspector";

describe("LogbookInspector", () => {
  test("renders runbook body and provenance", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "runbook",
          title: "Fix cache lock",
          body: {
            problemSignature: { symptoms: ["EBUSY"], errorStrings: [], affectedScope: "cache" },
            reproSteps: ["run tests twice"],
            fixSteps: ["serialize lock"],
            deadEnds: [],
            validationChecks: ["npm test"]
          },
          provenanceSessionIds: ["session:a", "session:b"],
          joinRationale: "shared EBUSY signature"
        }}
      />
    );

    expect(html).toContain("Fix cache lock");
    expect(html).toContain("serialize lock");
    expect(html).toContain("session:a");
    expect(html).toContain("shared EBUSY signature");
    expect(html).toContain("Artifact detail");
    expect(html).toContain('aria-label="Close artifact detail"');
    expect(html).toContain("Runbook");
    expect(html).toContain("EBUSY");
    expect(html).toContain("npm test");
    expect(html).not.toContain("Session detail");
  });

  test("renders session dossier sections and omits missing fields", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "session_dossier",
          title: "Repair OAuth callback",
          confidence: "high",
          project: "Masthead",
          body: {
            problemStatement: "OAuth return path fails",
            context: "Login callback after provider redirect",
            approach: ["Trace callback route", "Add state validation"],
            outcome: "Route still fails in one edge case",
            verification: ["Manual login flow"]
          },
          provenanceSessionIds: ["session:1"],
          provenanceLabel: "1 session"
        }}
      />
    );

    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("OAuth return path fails");
    expect(html).toContain("Trace callback route");
    expect(html).toContain("Route still fails in one edge case");
    expect(html).toContain("session:1");
    expect(html).not.toContain("Risks");
    expect(html).toContain("1 session");
  });

  test("renders loading state while artifact detail request is in flight", () => {
    const html = renderToStaticMarkup(<LogbookInspector loading onClose={() => undefined} />);

    expect(html).toContain("Artifact detail");
    expect(html).toContain("Loading artifact");
    expect(html).toContain("Loading artifact detail");
  });

  test("renders error state when artifact detail fails to load", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector error="Could not load artifact" onClose={() => undefined} />
    );

    expect(html).toContain("Artifact detail");
    expect(html).toContain("Could not load artifact");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Loading artifact detail");
  });

  test("pretty-prints unknown body shapes", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "custom_kind",
          title: "Unknown shape",
          body: { foo: "bar", nested: { n: 1 } },
          provenanceSessionIds: []
        }}
      />
    );

    expect(html).toContain("Unknown shape");
    expect(html).toContain("&quot;foo&quot;");
    expect(html).toContain("&quot;bar&quot;");
  });
});
