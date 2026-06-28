import { describe, expect, test } from "vitest";
import {
  buildDeterministicSessionCopy,
  sessionCopyCacheKey,
  toSessionCopyInput,
  validateSessionCopy
} from "../sessionCopy";
import type { AttentionItem, ConflictCard, SessionCardView } from "../types";

describe("session copy", () => {
  test("sanitizes session metadata into generic signals without leaking raw operational text", () => {
    const card = cardView({
      lifecycle: "running",
      primaryStatus: "waiting_for_approval",
      changedFileCount: 17,
      attentionReason: "Approve npm test in /workspace/app with OPENAI_API_KEY=sk-test",
      branchOrWorktree: "feature/secret-branch"
    });
    const attentionItems: AttentionItem[] = [
      attentionItem({
        title: "Approve npm test in /workspace/app",
        type: "approval_requested",
        affectedPaths: ["/workspace/app/src/secret.ts"],
        affectedCommandIds: ["cmd-npm-test"]
      })
    ];
    const input = toSessionCopyInput(card, attentionItems, []);
    const serialized = JSON.stringify(input);

    expect(input).toMatchObject({
      lifecycle: "running",
      primaryStatus: "waiting_for_approval",
      signals: ["approval_waiting"],
      changedFileBucket: "many"
    });
    expect(serialized).not.toContain("/");
    expect(serialized).not.toContain("npm");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("secret-branch");
    expect(serialized).not.toContain("Approve");
  });

  test("builds deterministic plain copy for running, ended action, and completed history states", () => {
    expect(buildDeterministicSessionCopy(toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []))).toMatchObject({
      headline: "App session is active now.",
      status: "Work is active.",
      source: "deterministic"
    });

    expect(
      buildDeterministicSessionCopy(
        toSessionCopyInput(
          cardView({ lifecycle: "ended", primaryStatus: "failed", outcomeLabel: "failed", endReason: "failed" }),
          [],
          []
        )
      )
    ).toMatchObject({
      headline: "App session ended after a failure signal.",
      status: "Follow-up is pending."
    });

    expect(
      buildDeterministicSessionCopy(
        toSessionCopyInput(cardView({ lifecycle: "ended", primaryStatus: "completed_unreviewed" }), [], [])
      )
    ).toMatchObject({
      headline: "App session had recent activity.",
      status: "Review is pending."
    });

    expect(
      buildDeterministicSessionCopy(
        toSessionCopyInput(
          cardView({ lifecycle: "ended", primaryStatus: "completed_reviewed", outcomeLabel: "completed", endReason: "completed" }),
          [],
          []
        )
      )
    ).toMatchObject({
      headline: "App session is filed in history.",
      status: "Filed in history."
    });
  });

  test("builds system-neutral deterministic copy across board states", () => {
    const states = [
      toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "waiting_for_approval" }), [attentionItem()], []),
      toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "waiting_for_user" }), [attentionItem({ type: "user_question" })], []),
      toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "running_command" }), [attentionItem({ type: "command_failed" })], []),
      toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []),
      toSessionCopyInput(cardView({ lifecycle: "idle", primaryStatus: "stalled" }), [], []),
      toSessionCopyInput(cardView({ lifecycle: "ended", primaryStatus: "blocked", outcomeLabel: "blocked", endReason: "blocked" }), [], []),
      toSessionCopyInput(cardView({ lifecycle: "ended", primaryStatus: "failed", outcomeLabel: "failed", endReason: "failed" }), [], []),
      toSessionCopyInput(cardView({ lifecycle: "ended", primaryStatus: "completed_reviewed", outcomeLabel: "completed" }), [], [])
    ];

    for (const input of states) {
      const copy = buildDeterministicSessionCopy(input);
      expect([copy.headline, copy.status, copy.reason, copy.nextStep ?? ""].join(" ")).not.toMatch(
        /\b(you|your|tyler|urgent|critical|dangerous|please|let's|i recommend|i finished|we need)\b/i
      );
    }
  });

  test("uses work context and treats completion feedback as a claim", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "running",
        primaryStatus: "editing",
        workContext: {
          label: "OAuth callback work",
          confidence: "title",
          pathClusters: ["auth"],
          sourceSignals: ["title:oauth"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-23T02:05:00.000Z",
          claims: ["claims_complete", "mentions_tests"]
        }
      }),
      [],
      []
    );

    expect(input.latestFeedback).toEqual({
      present: true,
      source: "stop_hook",
      observedAt: "2026-06-23T02:05:00.000Z",
      claims: ["claims_complete", "mentions_tests"]
    });
    expect(buildDeterministicSessionCopy(input)).toMatchObject({
      headline: "OAuth callback changes report completion and need review.",
      status: "Session reports completion.",
      reason: "The latest feedback mentions completion and verification, while deterministic state still needs review."
    });
  });

  test("uses a sanitized latest feedback summary as the main card headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "running",
        primaryStatus: "editing",
        workContext: {
          label: "UI work",
          confidence: "path_cluster",
          pathClusters: ["ui"],
          sourceSignals: ["path:ui"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T06:50:00.000Z",
          claims: ["mentions_files"],
          summary: "Live session cards no longer receive demo harness or model telemetry."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe(
      "Live session cards no longer receive demo harness or model telemetry."
    );
  });

  test("describes completed activity instead of using review status as the headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        workContext: {
          label: "Documentation work",
          confidence: "path_cluster",
          pathClusters: ["docs"],
          sourceSignals: ["path:docs"]
        }
      }),
      [],
      []
    );
    const copy = buildDeterministicSessionCopy(input);

    expect(copy.headline).toBe("Documentation changes are ready for review.");
    expect(copy.headline).toMatch(/[.!?]$/);
    expect(copy.headline).not.toBe("Documentation work");
    expect(copy.headline).not.toContain("waiting for review");
  });

  test("turns useful latest feedback fragments into sentence headlines", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T07:00:00.000Z",
          claims: ["mentions_files"],
          summary: "recent-session pattern audit for durable user signals."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe("App session had recent activity.");
  });

  test("rejects broken first-person feedback summaries before building the headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        workContext: {
          label: "Auth work",
          confidence: "path_cluster",
          pathClusters: ["auth"],
          sourceSignals: ["path:auth"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T07:00:00.000Z",
          claims: ["mentions_files"],
          summary: "The admin feature commit is , and I added one deployment fix change so Netlify ignores generated ."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe("Auth changes are ready for review.");
  });

  test("rejects dangling transition feedback summaries before building the headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "running",
        primaryStatus: "editing",
        workContext: {
          label: "UI work",
          confidence: "path_cluster",
          pathClusters: ["ui"],
          sourceSignals: ["path:ui"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T07:00:00.000Z",
          claims: ["mentions_files"],
          summary: "The card badge rendered almost every non-idle card as Active, including completed or review history. Now:."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe("UI changes are active now.");
  });

  test("rejects citation-only feedback summaries before building the headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "running",
        primaryStatus: "editing",
        workContext: {
          label: "UI work",
          confidence: "path_cluster",
          pathClusters: ["ui"],
          sourceSignals: ["path:ui"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T07:00:00.000Z",
          claims: ["claims_complete", "mentions_tests"],
          summary: "[src](:177) Verified:."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe("UI changes report completion and need review.");
  });

  test("rejects generic updated feedback summaries before building the headline", () => {
    const input = toSessionCopyInput(
      cardView({
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        workContext: {
          label: "Documentation work",
          confidence: "path_cluster",
          pathClusters: ["docs"],
          sourceSignals: ["path:docs"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-24T07:00:00.000Z",
          claims: ["mentions_files"],
          summary: "Updated file and file incrementally."
        }
      }),
      [],
      []
    );

    expect(buildDeterministicSessionCopy(input).headline).toBe("Documentation changes are ready for review.");
  });

  test("rejects model headlines that are category labels instead of sentences", () => {
    const input = toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []);

    expect(
      validateSessionCopy(
        {
          headline: "UI work",
          status: "Work is active.",
          reason: "This session is active and has recent activity."
        },
        input
      )
    ).toEqual({ ok: false, reason: "invalid_shape" });
  });

  test("rejects direct-address and alarmist main-board copy", () => {
    const input = toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "waiting_for_approval" }), [], []);

    expect(
      validateSessionCopy(
        {
          headline: "Needs your approval",
          status: "Waiting on you",
          reason: "You need to approve this before it can continue."
        },
        input
      )
    ).toEqual({ ok: false, reason: "unsafe_copy" });

    expect(
      validateSessionCopy(
        {
          headline: "Critical issue",
          status: "Dangerous conflict detected",
          reason: "Urgent action required."
        },
        input
      )
    ).toEqual({ ok: false, reason: "unsafe_copy" });

    expect(
      validateSessionCopy(
        {
          headline: "Please review",
          status: "I recommend action",
          reason: "We need to check this."
        },
        input
      )
    ).toEqual({ ok: false, reason: "unsafe_copy" });
  });

  test("rejects model copy that leaks raw tokens or invents unsupported completion", () => {
    const runningInput = toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []);

    expect(
      validateSessionCopy(
        {
          headline: "completed_unreviewed",
          status: "Done",
          reason: "See /workspace/app and run npm test.",
          source: "llm"
        },
        runningInput
      )
    ).toEqual({ ok: false, reason: "unsafe_copy" });

    expect(
      validateSessionCopy(
        {
          headline: "This session is completed.",
          status: "Finished",
          reason: "The task is completed.",
          source: "llm"
        },
        runningInput
      )
    ).toEqual({ ok: false, reason: "unsupported_claim" });
  });

  test("uses stable cache keys for equivalent sanitized inputs", () => {
    const input = toSessionCopyInput(cardView({ lifecycle: "idle", primaryStatus: "stalled", changedFileCount: 3 }), [], []);

    expect(sessionCopyCacheKey(input, "gpt-5-nano-2025-08-07")).toBe(
      sessionCopyCacheKey({ ...input, signals: [...input.signals] }, "gpt-5-nano-2025-08-07")
    );
    expect(sessionCopyCacheKey(input, "gpt-5.4-nano-2026-03-17")).not.toBe(
      sessionCopyCacheKey(input, "gpt-5-nano-2025-08-07")
    );
  });
});

function cardView(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "App",
    title: "Session title",
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 50,
    durationLabel: "4m",
    branchOrWorktree: "local",
    lastActivity: "2026-06-23T02:00:00.000Z",
    lastActivityLabel: "1m ago",
    changedFileCount: 0,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    copy: {
      headline: "Still running",
      status: "Working now",
      reason: "This session is active.",
      source: "deterministic"
    },
    ...overrides
  };
}

function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    itemId: "attention-1",
    sessionId: "session-1",
    project: "App",
    type: "approval_requested",
    severity: "P0",
    title: "Approval requested",
    createdAt: "2026-06-23T02:00:00.000Z",
    affectedPaths: [],
    affectedCommandIds: [],
    evidence: [],
    support: "deterministic",
    suggestedNextAction: "Review the request.",
    ...overrides
  };
}

function conflictCard(overrides: Partial<ConflictCard> = {}): ConflictCard {
  return {
    conflictId: "conflict-1",
    type: "exact_file_overlap",
    severity: "high",
    sessionIds: ["session-1", "session-2"],
    repo: { gitCommonDir: "/workspace/app/.git", worktreePaths: ["/workspace/app"] },
    sharedPaths: ["/workspace/app/src/shared.ts"],
    attribution: "direct",
    title: "Same file changed",
    evidence: [],
    ...overrides
  };
}
