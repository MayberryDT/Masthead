import { expect, test } from "vitest";
import type {
  GuidedAuthoringCapabilitiesDto,
  GuidedAuthoringNextAction,
  GuidedAuthoringRequestDto
} from "../../../shared/guidedAuthoring";
import { buildWorkbenchHandoff } from "../workbenchHandoff";

const APPROVED_PROSE = `Complete Masthead guided authoring request guided-request:one using the exact authoring command in the machine request.

You are acting as a knowledge editor. Produce grounded, specific knowledge that a future person or agent can reuse without reopening raw session evidence. Throughput is subordinate to quality.

Begin by running the supplied start command, then follow Masthead's returned nextAction until it issues an immutable completion receipt. Do not create a bulk-authoring script, loop over session IDs, sample only the first or last messages, or construct batches outside the guided workflow.

For every session, establish the actual purpose, work, outcome, decisions, verification, unresolved work, and reuse value from canonical evidence. If canonical evidence records a successful check, preserve it as passed verification with direct support; never downgrade it to not run, missing, or unknown. If high-signal evidence records a decision, include that decision in the dossier. Do not infer completion from a final assistant message.

Make the capsule summary carry the session's specific supported work or result whenever the dossier has a supported outcome or key work. Treat completion state as the state of the work, separately from verification status. A supported outcome, key work item, or result-bearing summary must never use an unknown work state; set completed, partial, blocked, failed, or paused as the evidence warrants even when verification is missing or unknown. Say missing or unknown verification explicitly in verification status and warnings, and optionally add it after the result as a caveat; use a pure 'Verification not run.' summary only when no outcome or key work is supported.

Treat the daemon scaffold as a structural contract. For each existing session claimSupport object, preserve its prefilled path and supportKind, replace its placeholder evidenceRef with one inspected canonical evidence item ID, and copy an exact excerpt. Then replace the matching placeholder in the owning enrichment field's evidenceRefs array with that evidence item's full {id, kind, observedAt, source} object; claimSupport.evidenceRef remains the matching item ID string. Keep title refs in sessionTitle, summary refs in sessionSummary, dossier-field refs in sessionDossier, and verification refs in sessionDossier.verification. Preserve daemon-prefilled artifact draft IDs, opportunity IDs, and artifact claimSupport evidenceRef, path, and supportKind values.

Keep each draft narrow and supportable. Omit unsupported optional content instead of inventing a claimSupport path or changing a prefilled supportKind. If the scaffold does not provide causal root-cause support, state that root cause is unknown instead of adding a causal assertion.

Write human-facing dossier and artifact fields only about the session's actual work and result. Never write meta or pipeline language such as 'guided authoring', 'evidence review', 'verification boundary', or 'reusable optional-artifact claims' in those fields.

For every knowledge opportunity, author a self-contained runbook, ADR, or incident timeline only when the evidence supports independent reuse. Otherwise record the evidence-backed reason for dismissing, merging, or changing its kind. If a daemon scaffold includes an authored optional artifact, fix its reported fields; do not delete it or dismiss its opportunity merely to escape a validation finding.

In a runbook, preserve every essential action clause and relationship from the cited performed-work evidence, including what was bound, replaced, cleared, retried, or restarted and the target each action applied to. When one evidence item states a compound performed action, keep one compound fix step with its one prefilled support; split it only when each new step has separate direct evidence.

Stop and report the blocker if evidence is insufficient, instance identity differs, or Masthead rejects the draft. Report publication only from the immutable finish receipt.`;

test("builds the exact V4 guided authoring handoff packet", () => {
  const text = buildWorkbenchHandoff({
    capabilities: capabilities(),
    request: createdRequest()
  });

  expect(text).toBe(`${APPROVED_PROSE}

Machine request:
{"protocol":"masthead.workbench.authoring/v1","bundleVersion":"workbench-authoring-v4","policyVersion":"guided-authoring-v1","requestId":"guided-request:one","databaseId":"database:test","buildSha":"build:test","startCommand":"/opt/masthead/bin/mastheadctl workbench author start --request guided-request:one --json"}`);
});

test("carries only the durable request identity and one absolute start command", () => {
  const text = buildWorkbenchHandoff({
    capabilities: capabilities(),
    request: createdRequest()
  });
  const machineLine = text.split("\n").find((line) => line.startsWith("{"));
  const machineRequest = JSON.parse(machineLine ?? "{}") as Record<string, unknown>;

  expect(Object.keys(machineRequest)).toEqual([
    "protocol",
    "bundleVersion",
    "policyVersion",
    "requestId",
    "databaseId",
    "buildSha",
    "startCommand"
  ]);
  expect(machineRequest.startCommand).toMatch(/^\//);
  expect(text.match(/"startCommand"/g)).toHaveLength(1);
  expect(text).not.toContain('"sessionIds"');
  expect(text).not.toContain("session:a");
  expect(text).not.toContain("session:b");
  expect(text).not.toContain("Selected session metadata");
  expect(text).not.toContain("maxSessionsPerRun");
  expect(text).not.toContain("authoringTool");
  expect(text).not.toContain("partition them into bounded runs");
  expect(text).not.toContain("completing every selected session exactly once");
});

test("teaches the compact scaffold grounding contract without embedding a schema", () => {
  const text = buildWorkbenchHandoff({
    capabilities: capabilities(),
    request: createdRequest()
  });

  expect(text).toContain("preserve its prefilled path and supportKind");
  expect(text).toContain("full {id, kind, observedAt, source} object");
  expect(text).toContain("claimSupport.evidenceRef remains the matching item ID string");
  expect(text).toContain("must never use an unknown work state");
  expect(text).toContain("keep one compound fix step");
  expect(text).toContain("Never write meta or pipeline language such as 'guided authoring', 'evidence review', 'verification boundary', or 'reusable optional-artifact claims'");
  expect(text).not.toContain('"properties"');
  expect(text).not.toContain('"required"');
});

function capabilities(): GuidedAuthoringCapabilitiesDto {
  return {
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "build:test",
    bundleVersion: "workbench-authoring-v4",
    canarySessions: 3,
    capability: "artifact_authoring",
    command: "/opt/masthead/bin/mastheadctl",
    databaseId: "database:test",
    instanceId: "instance:test",
    instanceManifest: "/tmp/masthead-instance.json",
    maxSessionsPerAssignment: 12,
    operations: ["start", "inspect", "scaffold", "save", "review", "finish"],
    policyVersion: "guided-authoring-v1",
    protocol: "masthead.workbench.authoring/v1"
  };
}

function createdRequest(): {
  request: GuidedAuthoringRequestDto;
  nextAction: GuidedAuthoringNextAction;
} {
  return {
    nextAction: {
      command: "/opt/masthead/bin/mastheadctl workbench author start --request guided-request:one --json",
      kind: "claim_next",
      reason: "The first assignment pack is ready to start."
    },
    request: {
      actorId: "workbench",
      assignmentCount: 1,
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      contractVersion: "workbench-authoring-v5",
      completedSessionCount: 0,
      createdAt: "2026-07-20T00:00:00.000Z",
      creationInstanceId: "instance:test",
      databaseId: "database:test",
      instanceManifest: "/tmp/masthead-instance.json",
      policyVersion: "guided-authoring-v1",
      requestId: "guided-request:one",
      sessionCount: 2,
      status: "active",
      updatedAt: "2026-07-20T00:00:00.000Z"
    }
  };
}
