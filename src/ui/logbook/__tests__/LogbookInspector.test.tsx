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
            claimEvidence: [{ path: "keyDecisions[0]", evidenceRefs: ["message:session:1:decision"] }],
            commandsAndTools: [{ label: "npm test", purpose: "Verify callback behavior", status: "passed" }],
            evidenceRefs: ["message:session:1:decision"],
            filesTouched: [{ label: "src/auth/callback.ts", role: "callback handler" }],
            keyDecisions: ["Validate state before token exchange"],
            lessonsLearned: ["Provider redirects must preserve state"],
            missingEvidence: ["No browser trace was captured"],
            outcome: "Route still fails in one edge case",
            verification: ["Manual login flow"],
            risksOrGaps: ["Legacy providers remain untested"]
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
    expect(html).toContain("Validate state before token exchange");
    expect(html).toContain("src/auth/callback.ts");
    expect(html).toContain("callback handler");
    expect(html).toContain("npm test");
    expect(html).toContain("Verify callback behavior");
    expect(html).toContain("passed");
    expect(html).toContain("Provider redirects must preserve state");
    expect(html).toContain("No browser trace was captured");
    expect(html).toContain("message:session:1:decision");
    expect(html).toContain("session:1");
    expect(html).toContain("Legacy providers remain untested");
    expect(html).toContain("1 session");
  });

  test("renders every runbook field while tolerating absent historical fields", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "runbook",
          title: "Repair lock",
          body: {
            problemSignature: { symptoms: ["Lock stalls"], errorStrings: ["ELOCK"], affectedScope: "cache" },
            preconditions: ["Worker is cancelled"],
            reproSteps: ["Cancel worker"],
            deadEnds: ["Retry without cleanup"],
            fixSteps: ["Close inherited descriptor"],
            commands: ["npm test"],
            changedFiles: ["src/cache.ts"],
            validationChecks: ["Lock suite passes"],
            environmentRequirements: ["Linux"],
            rootCause: "Descriptor ownership survived cancellation",
            preventionNotes: ["Track descriptor ownership"],
            risksOrGaps: ["Windows semantics unverified"],
            evidenceRefs: ["tool_result:lock"],
            claimEvidence: [{ path: "rootCause", evidenceRefs: ["tool_result:lock"] }],
            missingEvidence: ["No Windows trace"],
            provenanceSessionIds: ["session:lock"],
            joinRationale: "Shared lock signature",
            signatureKey: "signature:lock"
          },
          provenanceSessionIds: ["session:lock"]
        }}
      />
    );

    for (const value of [
      "Worker is cancelled",
      "Cancel worker",
      "Retry without cleanup",
      "Close inherited descriptor",
      "npm test",
      "src/cache.ts",
      "Lock suite passes",
      "Linux",
      "Descriptor ownership survived cancellation",
      "Track descriptor ownership",
      "Windows semantics unverified",
      "tool_result:lock",
      "No Windows trace",
      "signature:lock"
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain("logbook-inspector-json");
  });

  test("renders complete ADR fields without raw JSON fallback", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "adr",
          title: "Own authoring in daemon",
          body: {
            status: "accepted",
            context: "CLI-owned writes were fragile",
            decision: "The daemon owns authoring",
            alternatives: ["Keep direct CLI writes"],
            consequences: ["One transactional owner"],
            affectedPaths: ["src/daemon/server.ts"],
            supersedes: ["ADR-0004"]
          },
          provenanceSessionIds: ["session:adr"]
        }}
      />
    );

    expect(html).toContain("src/daemon/server.ts");
    expect(html).toContain("ADR-0004");
    expect(html).not.toContain("logbook-inspector-json");
  });

  test("renders complete incident timeline fields without raw JSON fallback", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "incident_timeline",
          title: "Writer collision",
          body: {
            symptom: "Two daemons wrote one database",
            impact: "Artifact state diverged",
            timeline: [
              {
                at: "2026-07-10T12:00:00.000Z",
                summary: "Collision observed",
                evidenceRefs: ["message:incident:collision"]
              }
            ],
            rootCause: "Ownership followed data directories",
            contributingFactors: ["Database overrides bypassed the lock"],
            remediation: ["Lock the canonical database path"],
            prevention: ["Exercise alias paths in tests"],
            status: "resolved"
          },
          provenanceSessionIds: ["session:incident"]
        }}
      />
    );

    expect(html).toContain("Ownership followed data directories");
    expect(html).toContain("Database overrides bypassed the lock");
    expect(html).toContain("Exercise alias paths in tests");
    expect(html).toContain("message:incident:collision");
    expect(html).toContain("resolved");
    expect(html).not.toContain("logbook-inspector-json");
  });

  test("keeps sparse historical known-kind bodies readable without raw JSON", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "runbook",
          title: "Historical runbook",
          body: { fixSteps: ["Retry once"] },
          provenanceSessionIds: ["session:historical"]
        }}
      />
    );

    expect(html).toContain("Retry once");
    expect(html).not.toContain("logbook-inspector-json");
  });

  test("does not use raw JSON fallback for malformed historical known-kind bodies", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector
        onClose={() => {}}
        artifact={{
          kind: "adr",
          title: "Historical ADR",
          body: "Historical decision body",
          provenanceSessionIds: ["session:historical-adr"]
        }}
      />
    );

    expect(html).toContain("Historical decision body");
    expect(html).not.toContain("logbook-inspector-json");
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
