import type { BoardHeadlineView } from "./boardHeadlineFrame";

export type EvidenceKind = "event" | "command" | "git_snapshot" | "file_change" | "conflict" | "redaction";

export type EvidenceRef = {
  id: string;
  kind: EvidenceKind;
  observedAt: string;
  source: string;
};

export type EventType =
  | "session.started"
  | "approval.requested"
  | "user.question"
  | "command.started"
  | "command.finished"
  | "file.changed"
  | "session.completed";

export type WorkspaceRef = {
  cwd?: string;
  repoRoot?: string;
  worktreePath?: string;
  gitCommonDir?: string;
  branch?: string;
  headSha?: string;
};

export type NormalizedEvent = {
  schemaVersion: 1;
  eventId: string;
  sessionId?: string;
  source: {
    adapter: "codex" | "git" | "masthead";
    surface: "hook" | "fixture" | "observer" | "user";
    sourceEventId?: string;
  };
  occurredAt: string;
  receivedAt: string;
  type: EventType;
  workspace?: WorkspaceRef;
  summary: string;
  payload: Record<string, unknown>;
  sensitivity: "metadata" | "redacted" | "sensitive_path_only";
  payloadHash: string;
  evidence: EvidenceRef[];
};

export type GitChangedPath = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  additions?: number;
  deletions?: number;
  sensitivity: "metadata" | "sensitive_path_only";
};

export type GitSnapshot = {
  snapshotId: string;
  sessionId: string;
  repoRoot: string;
  worktreePath: string;
  gitCommonDir: string;
  branch?: string;
  headSha?: string;
  changedPaths: GitChangedPath[];
  observedAt: string;
};

export type SessionStatus =
  | "starting"
  | "planning"
  | "reading"
  | "editing"
  | "running_command"
  | "testing"
  | "waiting_for_approval"
  | "waiting_for_user"
  | "blocked"
  | "stalled"
  | "possibly_looping"
  | "failed"
  | "completed_unreviewed"
  | "completed_reviewed"
  | "abandoned"
  | "unknown";

export type SessionLifecycle = "running" | "idle" | "ended";

export type SessionEndReason =
  | "completed"
  | "blocked"
  | "failed"
  | "needs_user"
  | "needs_approval"
  | "abandoned"
  | "unknown";

export type SessionOutcomeLabel =
  | "completed"
  | "needs_attention"
  | "blocked"
  | "failed"
  | "abandoned"
  | "unknown";

export type SessionFlag =
  | "dirty_worktree"
  | "uncommitted_changes"
  | "tests_passed"
  | "tests_failed"
  | "no_tests_observed"
  | "build_passed"
  | "build_failed"
  | "high_risk_change"
  | "exact_file_overlap"
  | "module_overlap"
  | "merge_conflict_likely"
  | "shared_resource_collision"
  | "agent_claims_complete"
  | "approval_pending"
  | "question_pending"
  | "adapter_degraded";

export type AttributionLevel = "direct" | "correlated" | "shared_workspace" | "unattributed";

export type DerivedSession = {
  sessionId: string;
  project: string;
  title: string;
  objective?: string;
  primaryStatus: SessionStatus;
  lifecycle: SessionLifecycle;
  outcomeLabel?: SessionOutcomeLabel;
  endReason?: SessionEndReason;
  endedAt?: string;
  lastEventType?: EventType;
  flags: SessionFlag[];
  lastMeaningfulActivityAt: string;
  attribution: AttributionLevel;
  workspace?: WorkspaceRef;
  changedFileCount: number;
  evidence: EvidenceRef[];
};

export type AttentionType =
  | "approval_requested"
  | "user_question"
  | "command_failed"
  | "repeated_failure"
  | "stalled"
  | "completed_without_verification"
  | "stale_verification"
  | "high_risk_change"
  | "conflict";

export type CommandFailureDetail = {
  commandId?: string;
  exitCode?: number;
  category?: string;
  occurredAt: string;
  evidenceId?: string;
};

export type AttentionItem = {
  itemId: string;
  sessionId: string;
  project: string;
  type: AttentionType;
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  createdAt: string;
  affectedPaths: string[];
  affectedCommandIds: string[];
  evidence: EvidenceRef[];
  support: "deterministic" | "inferred";
  suggestedNextAction: string;
  commandDetails?: CommandFailureDetail[];
  dismissedAt?: string;
  snoozedUntil?: string;
  resolvedAt?: string;
};

export type ConflictCard = {
  conflictId: string;
  type: "exact_file_overlap" | "same_worktree" | "shared_resource";
  severity: "high" | "medium" | "low";
  sessionIds: string[];
  repo: {
    gitCommonDir: string;
    worktreePaths: string[];
  };
  sharedPaths: string[];
  attribution: "direct" | "degraded";
  title: string;
  evidence: EvidenceRef[];
};

export type SafeAction =
  | "open_source_session"
  | "open_repo"
  | "open_file"
  | "open_readonly_diff"
  | "snooze"
  | "dismiss"
  | "mark_reviewed"
  | "mark_expected";

export type ReviewAnnotation = {
  status: "reviewed" | "expected" | "dismissed" | "snoozed" | "false_positive";
  recordedAt: string;
  stale: boolean;
  reason?: string;
  snoozedUntil?: string;
};

export type SessionCopySource = "deterministic" | "llm" | "fallback" | "enrichment";

export type BoardBrief = {
  text: string;
  source: SessionCopySource;
  priority: "normal" | "attention";
};

export type WorkAreaContext = {
  label: string;
  confidence: "title" | "branch" | "path_cluster" | "event_summary" | "feedback_snapshot" | "generic";
  pathClusters: string[];
  sourceSignals: string[];
};

export type LatestFeedbackSnapshot = {
  text: string;
  source: "stop_hook";
  observedAt: string;
  redacted: true;
  bytesIn: number;
  charsOut: number;
  claims: Array<"claims_complete" | "mentions_blocked" | "mentions_tests" | "mentions_error" | "mentions_files">;
};

export type LatestFeedbackSignal = {
  present: true;
  source: "stop_hook";
  observedAt: string;
  claims: LatestFeedbackSnapshot["claims"];
  summary?: string;
};

export type InspectorSectionId =
  | "state"
  | "latest_feedback"
  | "attention_conflicts"
  | "evidence"
  | "timeline"
  | "actions";

export type BoardHeadlineRefreshStatus =
  | "success"
  | "pending"
  | "not_configured"
  | "api_error"
  | "invalid_output"
  | "validation_failed";

export type BoardHeadlineRefreshState = {
  requestedAt: string;
  status: BoardHeadlineRefreshStatus;
  provider?: string;
  model?: string;
  latencyMs?: number;
  failureMessage?: string;
};

export type SessionCardView = {
  sessionId: string;
  canonicalSessionId?: string;
  sourceSessionId?: string;
  hostId?: string;
  runtime?: string;
  project: string;
  title: string;
  headline: BoardHeadlineView;
  stateLabel: string;
  primaryStatus: SessionStatus;
  lifecycle: SessionLifecycle;
  outcomeLabel?: SessionOutcomeLabel;
  endReason?: SessionEndReason;
  priorityRank: number;
  durationLabel: string;
  totalTokens?: number;
  branchOrWorktree?: string;
  model?: string;
  thinkingLevel?: string;
  harness?: string;
  startedAt?: string;
  lastActivity: string;
  lastActivityLabel: string;
  changedFileCount: number;
  attentionReason?: string;
  indicators: Array<"attention" | "conflict" | "verification" | "degraded" | "risk">;
  identityConfidence: AttributionLevel;
  safeActions: SafeAction[];
  isExpanded: boolean;
  workContext?: WorkAreaContext;
  latestFeedbackSignal?: LatestFeedbackSignal;
  headlineInput?: unknown;
  headlineRefresh?: BoardHeadlineRefreshState;
};

export type SessionDetailView = SessionCardView & {
  currentActivity: string;
  latestFeedback?: LatestFeedbackSnapshot;
  inspectorSections?: InspectorSectionId[];
  reviewAnnotations: ReviewAnnotation[];
  evidence: {
    observed: EvidenceRef[];
    inferred: EvidenceRef[];
    missing: EvidenceRef[];
  };
  conflicts: ConflictCard[];
  attentionItems: AttentionItem[];
  timeline: Array<{
    eventId: string;
    type: EventType;
    occurredAt: string;
    summary: string;
  }>;
  workspace?: WorkspaceRef;
};

export type ExpandedSessionView = SessionCardView & {
  evidence: {
    observed: EvidenceRef[];
    inferred: EvidenceRef[];
    missing: EvidenceRef[];
  };
  conflicts: ConflictCard[];
  attentionItems: AttentionItem[];
};

export type LifecycleLaneId = "running" | "idle" | "needs_action" | "history";

export type LifecycleLaneView = {
  laneId: LifecycleLaneId;
  title: string;
  count: number;
  sessionIds: string[];
};

export type LiveBoardProjection = {
  summary: {
    active: number;
    needsAttention: number;
    conflicts: number;
    completed: number;
    running?: number;
    needsAction?: number;
    idle?: number;
  };
  lanes?: LifecycleLaneView[];
  cards: SessionCardView[];
  expandedSession?: ExpandedSessionView;
  selectedSession?: SessionDetailView;
  brief?: BoardBrief;
  headlineRefreshSummary?: {
    requested: number;
    succeeded: number;
    failed: number;
    pending: number;
    generatedAt: string;
  };
  attentionQueue: AttentionItem[];
  conflicts: ConflictCard[];
};

export type FixtureReplay = {
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  expandedSessionId?: string;
};
