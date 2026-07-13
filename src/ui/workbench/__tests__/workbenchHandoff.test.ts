import { expect, test } from "vitest";
import type { WorkbenchArtifactCandidateDto } from "../../../shared/workbenchAuthoring";
import { buildWorkbenchHandoff } from "../workbenchHandoff";

test("handoff asks for one reusable candidate artifact and never asks for dossier prose", () => {
  const text = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    candidate: candidate(),
    databaseId: "database:test"
  });

  expect(text).toContain("candidate:runbook:oauth");
  expect(text).toContain("Author one reusable runbook");
  expect(text).toContain("Repeated OAuth refresh failures were fixed and verified");
  expect(text).toContain("2 provenance sessions");
  expect(text).toContain("verbatim claim excerpt");
  expect(text).not.toContain("read every item named by every session evidence manifest");
  expect(text).not.toMatch(/session dossier/i);
  expect(text).not.toContain("otherwise resolve them as N/A");
});

test("keeps candidate protocol mechanics in one exact machine request", () => {
  const text = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    candidate: candidate(),
    databaseId: "database:test"
  });
  const machineLine = text.split("\n").find((line) => line.startsWith("{"));
  const request = JSON.parse(machineLine ?? "{}") as Record<string, unknown>;

  expect(request).toEqual({
    protocol: "masthead.workbench.authoring/v1",
    bundleVersion: "workbench-authoring-v2",
    capability: "artifact_authoring",
    databaseId: "database:test",
    evidencePolicy: "candidate_scoped_canonical_evidence",
    transport: "daemon_http",
    candidateId: "candidate:runbook:oauth",
    kind: "runbook",
    evidenceRevision: "revision:oauth",
    provenanceSessionIds: ["session:oauth-a", "session:oauth-b"],
    authoringTool: {
      command: "/home/test/.local/bin/mastheadctl",
      kind: "cli"
    }
  });
  const visible = text.slice(0, text.indexOf("Machine request:"));
  expect(visible).not.toContain("/home/test/.local/bin");
  expect(visible).not.toContain("protocol");
  expect(visible).not.toContain("bundleVersion");
});

test("formats each candidate kind as one requested reusable artifact", () => {
  for (const [kind, label] of [
    ["runbook", "runbook"],
    ["adr", "adr"],
    ["incident_timeline", "incident timeline"]
  ] as const) {
    const text = buildWorkbenchHandoff({
      authoringCommand: "/home/test/.local/bin/mastheadctl",
      candidate: candidate({ kind }),
      databaseId: "database:test"
    });
    expect(text).toContain(`Author one reusable ${label}`);
  }
});

test("sanitizes untrusted candidate text in the visible request while preserving the exact machine identity", () => {
  const text = buildWorkbenchHandoff({
    authoringCommand: "/home/test/.local/bin/mastheadctl",
    candidate: candidate({
      candidateId: "candidate:npm run",
      signalSummary: "Use schema.json then apply.sh"
    }),
    databaseId: "database:test"
  });
  const visible = text.slice(0, text.indexOf("Machine request:"));
  const machine = text.slice(text.indexOf("Machine request:"));

  expect(visible).not.toContain("npm run");
  expect(visible).not.toContain("schema.json");
  expect(visible).not.toContain("apply.sh");
  expect(machine).toContain('"candidateId":"candidate:npm run"');
});

function candidate(overrides: Partial<WorkbenchArtifactCandidateDto> = {}): WorkbenchArtifactCandidateDto {
  return {
    candidateId: "candidate:runbook:oauth",
    createdAt: "2026-07-12T12:00:00.000Z",
    evidenceRevision: "revision:oauth",
    kind: "runbook",
    origin: "automatic",
    provenanceSessionIds: ["session:oauth-a", "session:oauth-b"],
    seedSessionId: "session:oauth-a",
    signalEvidenceRefs: ["evidence:problem", "evidence:change", "evidence:verification"],
    signalSummary: "Repeated OAuth refresh failures were fixed and verified",
    signatureKey: "oauth-refresh-failure",
    status: "pending",
    updatedAt: "2026-07-12T12:00:00.000Z",
    ...overrides
  };
}
