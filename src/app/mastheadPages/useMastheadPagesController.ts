import { useCallback, useMemo, useRef, useState } from "react";
import type { EgressFinding } from "../../mastheadPages/egressPreflight";
import {
  PARENT_CONFLICT_COPY,
  canRemoveFromPages,
  canRetryPendingPublication,
  canRetryPendingRemoval,
  confirmPublishLabel,
  deriveReleaseState,
  type ReleaseMappingSnapshot,
} from "../../mastheadPages/releaseState";
import type {
  PageLicense,
  PublishPageBatchResultV1,
  PublishPageRequestV1,
  PublishPageResultV1,
  PublicLogbookSummaryV1,
  RemovePageResultV1,
  SourceLinkV1,
} from "../../mastheadPages/types";
import {
  finalizeAndStageMastheadPagesReviews,
  getPendingMastheadPagesOperation,
  prepareMastheadPagesReviews,
  recordMastheadPagesResults,
  stageMastheadPagesRemoval,
} from "../daemonClient";
import type { MastheadPagesConnectionState } from "../desktopBridge";
import {
  createMastheadPagesDesktopClient,
  isMastheadPagesDesktopClientAvailable,
  type MastheadPagesDesktopClient,
} from "./desktopClient";
import { sha256CanonicalRequest } from "./requestDigest";
import type {
  ExistingReleaseSnapshot,
  FinalizedPageReviewItem,
  MastheadPagesBatchItem,
  MastheadPagesBatchState,
  MastheadPagesEvidenceCandidate,
  MastheadPagesEvidenceSelection,
  MastheadPagesPublicationOutcome,
  MastheadPagesReviewPhase,
  MastheadPagesReviewState,
  PreparedPageReviewItem,
} from "./types";

export type MastheadPagesControllerDeps = {
  baseUrl: string;
  desktopClient?: MastheadPagesDesktopClient;
  desktopAvailable?: () => boolean;
  prepareReviews?: typeof prepareMastheadPagesReviews;
  finalizeReviews?: typeof finalizeAndStageMastheadPagesReviews;
  recordResults?: typeof recordMastheadPagesResults;
  stageRemoval?: typeof stageMastheadPagesRemoval;
  getPendingOperation?: typeof getPendingMastheadPagesOperation;
  now?: () => string;
};

const initialState = (): MastheadPagesReviewState => ({
  phase: "closed",
  logbooks: [],
  publicLogbookId: "",
  license: "all-rights-reserved",
  slug: "",
  selectedEvidenceRefs: [],
  evidenceCandidates: [],
  sourceLinks: [],
  includeSourceDate: false,
  acknowledgeWarnings: false,
  prepareFindings: [],
  releaseState: "not_on_pages",
  confirmPublishLabel: "Publish to Masthead Pages",
  removalConfirmOpen: false,
  outcome: { kind: "idle" },
});

const initialBatchState = (): MastheadPagesBatchState => ({
  phase: "closed",
  artifactIds: [],
  items: [],
  logbooks: [],
  publicLogbookId: "",
  license: "all-rights-reserved",
  acknowledgeWarnings: false,
});

function slugifyArtifact(
  title: string | undefined,
  artifactId: string,
): string {
  return slugify(title ?? artifactId);
}

function defaultEvidenceSelections(
  prepared: PreparedPageReviewItem,
): MastheadPagesEvidenceSelection[] {
  return prepared.evidenceCandidates
    .filter((candidate) => !candidate.lowValue)
    .slice(0, 20)
    .map((candidate) => ({
      ref: candidate.ref,
      kind: defaultKind(candidate),
      label: candidate.label?.trim() || candidate.toolName || candidate.ref,
      supports: defaultSupports(candidate),
    }));
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "page";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseReleaseMapping(
  raw: unknown,
): ExistingReleaseSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const statusRaw = row.status;
  const status =
    statusRaw === "live" ||
    statusRaw === "failed" ||
    statusRaw === "removed" ||
    statusRaw === "none"
      ? statusRaw
      : "none";
  const mapping: ExistingReleaseSnapshot = {
    status,
    ...(typeof row.localContentFingerprint === "string"
      ? { localContentFingerprint: row.localContentFingerprint }
      : {}),
    ...(typeof row.pageId === "string" ? { pageId: row.pageId } : {}),
    ...(typeof row.objectId === "string" ? { objectId: row.objectId } : {}),
    ...(typeof row.parentObjectId === "string"
      ? { parentObjectId: row.parentObjectId }
      : {}),
    ...(typeof row.friendlyUrl === "string"
      ? { friendlyUrl: row.friendlyUrl }
      : {}),
    ...(typeof row.exactUrl === "string" ? { exactUrl: row.exactUrl } : {}),
    ...(typeof row.publicLogbookId === "string"
      ? { publicLogbookId: row.publicLogbookId }
      : {}),
    ...(row.pendingOperationKind === "publish" ||
    row.pendingOperationKind === "remove"
      ? { pendingOperationKind: row.pendingOperationKind }
      : {}),
    ...(typeof row.pendingRequestDigest === "string"
      ? { pendingRequestDigest: row.pendingRequestDigest }
      : {}),
    ...(typeof row.pendingIdempotencyKey === "string"
      ? { pendingIdempotencyKey: row.pendingIdempotencyKey }
      : {}),
    ...(typeof row.lastErrorClass === "string"
      ? { lastErrorClass: row.lastErrorClass }
      : {}),
    ...(typeof row.lastErrorMessage === "string"
      ? { lastErrorMessage: row.lastErrorMessage }
      : {}),
  };
  return mapping;
}

function parsePrepared(raw: unknown): PreparedPageReviewItem {
  const row = asRecord(raw);
  return {
    artifactId: String(row.artifactId ?? ""),
    eligibility: row.eligibility === "eligible" ? "eligible" : "ineligible",
    ineligibilityReason:
      typeof row.ineligibilityReason === "string"
        ? row.ineligibilityReason
        : undefined,
    evidenceCandidates: Array.isArray(row.evidenceCandidates)
      ? (row.evidenceCandidates as MastheadPagesEvidenceCandidate[])
      : [],
    findings: Array.isArray(row.findings)
      ? (row.findings as EgressFinding[])
      : [],
    title: typeof row.title === "string" ? row.title : undefined,
    contentFingerprint:
      typeof row.contentFingerprint === "string"
        ? row.contentFingerprint
        : undefined,
    lineageId: typeof row.lineageId === "string" ? row.lineageId : undefined,
    baseObject: row.baseObject,
    existingRelease: parseReleaseMapping(row.existingRelease),
  };
}

function parseFinalized(raw: unknown): FinalizedPageReviewItem {
  const row = asRecord(raw);
  return {
    artifactId: String(row.artifactId ?? ""),
    decision:
      row.decision === "ready" ||
      row.decision === "needs_review" ||
      row.decision === "blocked"
        ? row.decision
        : "blocked",
    findings: Array.isArray(row.findings)
      ? (row.findings as EgressFinding[])
      : [],
    request: row.request as PublishPageRequestV1 | undefined,
    requestDigest:
      typeof row.requestDigest === "string"
        ? (row.requestDigest as FinalizedPageReviewItem["requestDigest"])
        : undefined,
    staged: row.staged === true,
    existingRelease: parseReleaseMapping(row.existingRelease),
  };
}

function defaultSupports(candidate: MastheadPagesEvidenceCandidate): string[] {
  if (candidate.kind === "verification" || candidate.role === "verification")
    return ["verification"];
  return ["outcome"];
}

function defaultKind(
  candidate: MastheadPagesEvidenceCandidate,
): "excerpt" | "verification" {
  if (candidate.kind === "verification" || candidate.role === "verification")
    return "verification";
  return "excerpt";
}

function connectionGate(
  connection: MastheadPagesConnectionState | undefined,
): MastheadPagesReviewState["gate"] {
  if (!connection) return "disconnected";
  if (connection.status === "disconnected") return "disconnected";
  if (connection.status === "secure_storage_unavailable")
    return "secure_storage_unavailable";
  if (
    connection.status === "connected" &&
    connection.account.publisherAccess !== "publisher"
  ) {
    return "non_publisher";
  }
  return undefined;
}

function isSuccessResult(
  result: PublishPageResultV1,
): result is Extract<
  PublishPageResultV1,
  { status: "published" | "idempotent-replay" }
> {
  return result.status === "published" || result.status === "idempotent-replay";
}

function withReleaseFields(
  state: MastheadPagesReviewState,
  overrides: Partial<MastheadPagesReviewState> = {},
): MastheadPagesReviewState {
  const next = { ...state, ...overrides };
  const mapping = (next.releaseMapping ??
    next.finalized?.existingRelease ??
    next.prepared?.existingRelease) as ReleaseMappingSnapshot | undefined;
  const releaseState = deriveReleaseState({
    mapping,
    currentFingerprint: next.prepared?.contentFingerprint,
    phase: next.phase,
    decision: next.finalized?.decision,
    outcomeKind: next.outcome.kind,
  });
  return {
    ...next,
    releaseMapping: mapping,
    releaseState,
    confirmPublishLabel: confirmPublishLabel(mapping, releaseState),
  };
}

function availablePublicLogbookId(
  preferredId: string | undefined,
  logbooks: PublicLogbookSummaryV1[],
  fallbackId = "",
): string {
  if (preferredId && logbooks.some((logbook) => logbook.id === preferredId)) {
    return preferredId;
  }
  return logbooks[0]?.id || fallbackId;
}

export function useMastheadPagesController(deps: MastheadPagesControllerDeps) {
  const [state, setState] = useState<MastheadPagesReviewState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [batchState, setBatchState] =
    useState<MastheadPagesBatchState>(initialBatchState);
  const batchStateRef = useRef(batchState);
  batchStateRef.current = batchState;
  const finalizeReviewRef = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );

  const desktopAvailable =
    deps.desktopAvailable ?? isMastheadPagesDesktopClientAvailable;
  const desktopClient = useMemo(
    () => deps.desktopClient ?? createMastheadPagesDesktopClient(),
    [deps.desktopClient],
  );
  const prepareReviews = deps.prepareReviews ?? prepareMastheadPagesReviews;
  const finalizeReviews =
    deps.finalizeReviews ?? finalizeAndStageMastheadPagesReviews;
  const recordResults = deps.recordResults ?? recordMastheadPagesResults;
  const stageRemoval = deps.stageRemoval ?? stageMastheadPagesRemoval;
  const getPendingOperation =
    deps.getPendingOperation ?? getPendingMastheadPagesOperation;
  const now = deps.now ?? (() => new Date().toISOString());

  const patch = useCallback(
    (
      update:
        | Partial<MastheadPagesReviewState>
        | ((current: MastheadPagesReviewState) => MastheadPagesReviewState),
    ) => {
      setState((current) => {
        const merged =
          typeof update === "function"
            ? update(current)
            : { ...current, ...update };
        const next = withReleaseFields(merged);
        stateRef.current = next;
        return next;
      });
    },
    [],
  );

  const patchBatch = useCallback(
    (
      update:
        | Partial<MastheadPagesBatchState>
        | ((current: MastheadPagesBatchState) => MastheadPagesBatchState),
    ) => {
      setBatchState((current) => {
        const next =
          typeof update === "function"
            ? update(current)
            : { ...current, ...update };
        batchStateRef.current = next;
        return next;
      });
    },
    [],
  );

  const refreshConnection = useCallback(async (): Promise<
    MastheadPagesConnectionState | undefined
  > => {
    if (!desktopAvailable()) {
      patch({ connection: undefined, gate: "desktop_unavailable" });
      return undefined;
    }
    try {
      const connection = await desktopClient.getConnection();
      const gate = connectionGate(connection);
      patch({
        connection,
        gate:
          gate === "disconnected" ||
          gate === "secure_storage_unavailable" ||
          gate === "non_publisher"
            ? gate
            : undefined,
      });
      return connection;
    } catch (error) {
      patch({
        connection: undefined,
        error: error instanceof Error ? error.message : String(error),
        gate: "desktop_unavailable",
      });
      return undefined;
    }
  }, [desktopAvailable, desktopClient, patch]);

  const loadLogbooks = useCallback(async () => {
    if (!desktopAvailable()) return [];
    try {
      const logbooks = await desktopClient.listPublicLogbooks();
      patch((current) =>
        withReleaseFields({
          ...current,
          logbooks,
          publicLogbookId: current.publicLogbookId || logbooks[0]?.id || "",
        }),
      );
      return logbooks;
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }, [desktopAvailable, desktopClient, patch]);

  const connect = useCallback(async () => {
    if (!desktopAvailable()) {
      patch({
        gate: "desktop_unavailable",
        error: "Masthead Pages requires the desktop app.",
      });
      return;
    }
    try {
      const connection = await desktopClient.connect();
      const gate = connectionGate(connection);
      patch({ connection, gate, error: undefined });
      if (
        connection.status === "connected" &&
        connection.account.publisherAccess === "publisher"
      ) {
        await loadLogbooks();
      }
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) });
    }
  }, [desktopAvailable, desktopClient, loadLogbooks, patch]);

  const disconnect = useCallback(async () => {
    if (!desktopAvailable()) return;
    await desktopClient.disconnect();
    patch({
      connection: { status: "disconnected" },
      gate: "disconnected",
      logbooks: [],
    });
  }, [desktopAvailable, desktopClient, patch]);

  const closeReview = useCallback(() => {
    patch(initialState());
  }, [patch]);

  const closeBatchReview = useCallback(() => {
    patchBatch(initialBatchState());
  }, [patchBatch]);

  const openBatchReview = useCallback(
    async (artifactIds: string[]) => {
      const uniqueIds = [...new Set(artifactIds.filter(Boolean))].slice(0, 500);
      patchBatch({
        ...initialBatchState(),
        phase: "loading",
        artifactIds: uniqueIds,
        items: uniqueIds.map((artifactId) => ({
          artifactId,
          selectedForPublish: false,
          outcome: { kind: "idle" },
        })),
      });
      // Single-page dialog must not compete with batch review.
      patch(initialState());

      if (!desktopAvailable()) {
        patchBatch({
          phase: "error",
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app.",
        });
        return;
      }

      const connection = await refreshConnection();
      const gate = connectionGate(connection);
      if (gate) {
        patchBatch({
          phase: "editing",
          connection,
          gate,
          error:
            gate === "disconnected"
              ? "Connect Masthead Pages before publishing."
              : gate === "secure_storage_unavailable"
                ? "OS secure storage is unavailable."
                : "Publisher access is required to publish Pages.",
        });
        return;
      }

      const logbooks = await loadLogbooks();
      try {
        const response = (await prepareReviews(
          { artifactIds: uniqueIds },
          deps.baseUrl,
        )) as {
          ok?: boolean;
          items?: unknown[];
        };
        const preparedItems = (response.items ?? []).map(parsePrepared);
        const byId = new Map(
          preparedItems.map((item) => [item.artifactId, item]),
        );
        const items: MastheadPagesBatchItem[] = uniqueIds.map((artifactId) => {
          const prepared = byId.get(artifactId) ?? {
            artifactId,
            eligibility: "ineligible" as const,
            ineligibilityReason: "prepare_missing",
            evidenceCandidates: [],
            findings: [],
          };
          return {
            artifactId,
            title: prepared.title,
            prepared,
            contentFingerprint: prepared.contentFingerprint,
            selectedForPublish: false,
            outcome: { kind: "idle" as const },
          };
        });
        const preferredLogbookId = availablePublicLogbookId(
          items.find((item) => item.prepared?.existingRelease?.publicLogbookId)
            ?.prepared?.existingRelease?.publicLogbookId,
          logbooks,
        );
        patchBatch({
          phase: "editing",
          connection,
          logbooks,
          publicLogbookId: preferredLogbookId,
          items,
          gate: undefined,
          error: undefined,
        });
      } catch (error) {
        patchBatch({
          phase: "error",
          connection,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      deps.baseUrl,
      desktopAvailable,
      loadLogbooks,
      patch,
      patchBatch,
      prepareReviews,
      refreshConnection,
    ],
  );

  const setBatchLicense = useCallback(
    (license: PageLicense) => {
      patchBatch({ license });
    },
    [patchBatch],
  );

  const setBatchPublicLogbookId = useCallback(
    (publicLogbookId: string) => {
      patchBatch({ publicLogbookId });
    },
    [patchBatch],
  );

  const setBatchAcknowledgeWarnings = useCallback(
    (acknowledgeWarnings: boolean) => {
      patchBatch({ acknowledgeWarnings });
    },
    [patchBatch],
  );

  const setBatchItemSelectedForPublish = useCallback(
    (artifactId: string, selected: boolean) => {
      patchBatch((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.artifactId === artifactId &&
          item.finalized?.decision === "ready" &&
          item.finalized.staged
            ? { ...item, selectedForPublish: selected }
            : item,
        ),
      }));
    },
    [patchBatch],
  );

  const finalizeBatchReview = useCallback(async () => {
    const current = batchStateRef.current;
    if (current.phase === "closed" || current.items.length === 0) return;
    if (
      current.gate === "desktop_unavailable" ||
      current.gate === "disconnected" ||
      current.gate === "secure_storage_unavailable" ||
      current.gate === "non_publisher"
    ) {
      return;
    }
    if (!current.publicLogbookId.trim()) {
      patchBatch({ error: "Choose a destination Public Logbook." });
      return;
    }
    const connection = current.connection;
    if (!connection || connection.status !== "connected") {
      patchBatch({
        gate: "disconnected",
        error: "Connect Masthead Pages before publishing.",
      });
      return;
    }

    const eligible = current.items.filter(
      (item) => item.prepared?.eligibility === "eligible",
    );
    if (eligible.length === 0) {
      patchBatch({
        error: "No eligible Pages in this batch.",
        phase: "reviewing",
      });
      return;
    }

    patchBatch({ phase: "finalizing", error: undefined });
    try {
      const response = (await finalizeReviews(
        {
          items: eligible.map((item) => ({
            artifactId: item.artifactId,
            publicLogbookId: current.publicLogbookId,
            pagesAccountId: connection.account.accountId,
            slug: slugifyArtifact(
              item.title ?? item.prepared?.title,
              item.artifactId,
            ),
            license: current.license,
            evidenceSelections: item.prepared
              ? defaultEvidenceSelections(item.prepared)
              : [],
            acknowledgeWarnings: current.acknowledgeWarnings,
          })),
        },
        deps.baseUrl,
      )) as { ok?: boolean; items?: unknown[] };

      const finalizedById = new Map(
        (response.items ?? []).map((raw) => {
          const finalized = parseFinalized(raw);
          return [finalized.artifactId, finalized] as const;
        }),
      );

      patchBatch((prev) => {
        const items = prev.items.map((item) => {
          const finalized = finalizedById.get(item.artifactId);
          if (!finalized) return item;
          const ready =
            finalized.decision === "ready" && finalized.staged === true;
          return {
            ...item,
            finalized,
            selectedForPublish: ready,
            outcome: { kind: "idle" as const },
          };
        });
        return {
          ...prev,
          phase: "reviewing",
          items,
          error: undefined,
          gate: undefined,
        };
      });
    } catch (error) {
      patchBatch({
        phase: "editing",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [deps.baseUrl, finalizeReviews, patchBatch]);

  const confirmBatchPublish = useCallback(async () => {
    const current = batchStateRef.current;
    const readyRefs = current.items.filter(
      (item) =>
        item.selectedForPublish &&
        item.finalized?.decision === "ready" &&
        item.finalized.staged &&
        item.finalized.request &&
        item.finalized.requestDigest,
    );
    if (readyRefs.length === 0) {
      patchBatch({ error: "Select at least one Ready Page to publish." });
      return;
    }
    if (!desktopAvailable()) {
      patchBatch({
        gate: "desktop_unavailable",
        error: "Masthead Pages requires the desktop app.",
      });
      return;
    }

    // The browser review client never sends hosted traffic and validates each staged
    // daemon digest itself; insecure HTTP review origins do not expose Web Crypto.
    if (!desktopClient.browserReviewOnly) {
      for (const item of readyRefs) {
        const recomputed = await sha256CanonicalRequest(
          item.finalized!.request!,
        );
        if (recomputed !== item.finalized!.requestDigest) {
          patchBatch({
            phase: "editing",
            error: `Outbound request digest changed for ${item.artifactId}. Re-run review before publishing.`,
          });
          return;
        }
      }
    }

    patchBatch({ phase: "publishing", error: undefined });
    try {
      const batch = (await desktopClient.publishStaged(
        readyRefs.map((item) => ({
          artifactId: item.artifactId,
          requestDigest: item.finalized!.requestDigest!,
        })),
      )) as PublishPageBatchResultV1;

      const resultsByKey = new Map(
        (batch.results ?? []).map(
          (result) => [result.idempotencyKey, result] as const,
        ),
      );
      const connection = current.connection;
      const pagesAccountId =
        connection && connection.status === "connected"
          ? connection.account.accountId
          : "";

      const nextItems: MastheadPagesBatchItem[] = [];
      for (const item of current.items) {
        if (!readyRefs.some((ref) => ref.artifactId === item.artifactId)) {
          nextItems.push(item);
          continue;
        }
        const key = item.finalized?.request?.idempotencyKey;
        const result = key ? resultsByKey.get(key) : undefined;
        if (!result) {
          const message = "Hosted publish returned no itemized result.";
          try {
            await recordResults(
              {
                kind: "failure",
                failure: {
                  artifactId: item.artifactId,
                  errorClass: "missing_item_result",
                  message,
                  retryable: true,
                  recordedAt: now(),
                },
              },
              deps.baseUrl,
            );
          } catch {
            // keep going
          }
          nextItems.push({
            ...item,
            outcome: { kind: "failed", message, retryable: true },
          });
          continue;
        }

        if (isSuccessResult(result)) {
          if (!desktopClient.browserReviewOnly)
            await recordResults(
              {
                kind: "publication",
                receipt: {
                  artifactId: item.artifactId,
                  pageId: result.pageId,
                  objectId: result.objectId,
                  parentObjectId: result.parentObjectId,
                  pagesAccountId,
                  publicLogbookId: item.finalized!.request!.publicLogbookId,
                  localContentFingerprint:
                    item.contentFingerprint ??
                    item.prepared?.contentFingerprint ??
                    "",
                  egressFingerprint: item.finalized!.requestDigest,
                  friendlyUrl: result.currentUrl,
                  exactUrl: result.exactRevisionUrl,
                  publishedAt: result.publishedAt,
                },
              },
              deps.baseUrl,
            );
          nextItems.push({
            ...item,
            selectedForPublish: false,
            finalized: item.finalized
              ? { ...item.finalized, staged: false }
              : item.finalized,
            outcome: {
              kind: "published",
              result,
              friendlyUrl: result.currentUrl,
              exactUrl: result.exactRevisionUrl,
            },
          });
          continue;
        }

        const retryable =
          result.retryable === true && result.code !== "parent-conflict";
        await recordResults(
          {
            kind: "failure",
            failure: {
              artifactId: item.artifactId,
              errorClass: result.code,
              message: result.message,
              retryable,
              recordedAt: now(),
              currentObjectId: result.currentObjectId,
            },
          },
          deps.baseUrl,
        );
        nextItems.push({
          ...item,
          outcome: {
            kind: "failed",
            message: result.message,
            retryable,
            code: result.code,
          },
        });
      }

      patchBatch({
        phase: "complete",
        items: nextItems,
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of readyRefs) {
        try {
          await recordResults(
            {
              kind: "failure",
              failure: {
                artifactId: item.artifactId,
                errorClass: "hosted_transport_error",
                message,
                retryable: true,
                recordedAt: now(),
              },
            },
            deps.baseUrl,
          );
        } catch {
          // keep going
        }
      }
      patchBatch({
        phase: "reviewing",
        error: message,
      });
    }
  }, [
    deps.baseUrl,
    desktopAvailable,
    desktopClient,
    now,
    patchBatch,
    recordResults,
  ]);

  const openSingleReview = useCallback(
    async (
      artifactId: string,
      options?: { openRemovalConfirmation?: boolean },
    ) => {
      patch({
        ...initialState(),
        phase: "loading",
        artifactId,
        outcome: { kind: "idle" },
      });

      if (!desktopAvailable()) {
        patch({
          phase: "error",
          artifactId,
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app.",
        });
        return;
      }

      const connection = await refreshConnection();
      const gate = connectionGate(connection);
      if (gate) {
        patch({
          phase: "editing",
          artifactId,
          connection,
          gate,
          error:
            gate === "disconnected"
              ? "Connect Masthead Pages before publishing."
              : gate === "secure_storage_unavailable"
                ? "OS secure storage is unavailable."
                : "Publisher access is required to publish Pages.",
        });
        return;
      }

      const logbooks = await loadLogbooks();

      try {
        const response = (await prepareReviews(
          { artifactIds: [artifactId] },
          deps.baseUrl,
        )) as {
          ok?: boolean;
          items?: unknown[];
        };
        const prepared = parsePrepared(response.items?.[0]);
        if (!prepared.artifactId) prepared.artifactId = artifactId;
        if (prepared.eligibility !== "eligible") {
          patch({
            phase: "editing",
            artifactId,
            connection,
            logbooks,
            prepared,
            title: prepared.title,
            prepareFindings: prepared.findings,
            evidenceCandidates: prepared.evidenceCandidates,
            releaseMapping: prepared.existingRelease,
            gate: "ineligible",
            error: prepared.ineligibilityReason
              ? `This Page is not eligible: ${prepared.ineligibilityReason}`
              : "This Page is not eligible for Masthead Pages.",
          });
          return;
        }

        const defaultSlug = slugify(prepared.title ?? artifactId);
        const preferredLogbookId = availablePublicLogbookId(
          prepared.existingRelease?.publicLogbookId,
          logbooks,
          stateRef.current.publicLogbookId,
        );
        patch({
          phase: "editing",
          artifactId,
          connection,
          logbooks,
          prepared,
          title: prepared.title,
          prepareFindings: prepared.findings,
          evidenceCandidates: prepared.evidenceCandidates,
          selectedEvidenceRefs: [],
          slug: defaultSlug,
          publicLogbookId: preferredLogbookId,
          license: "all-rights-reserved",
          releaseMapping: prepared.existingRelease,
          gate: undefined,
          error: undefined,
          finalized: undefined,
          acknowledgeWarnings: false,
          removalConfirmOpen:
            options?.openRemovalConfirmation === true &&
            canRemoveFromPages(prepared.existingRelease),
          parentConflictObjectId: undefined,
          outcome: { kind: "idle" },
        });
      } catch (error) {
        patch({
          phase: "error",
          artifactId,
          connection,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      deps.baseUrl,
      desktopAvailable,
      loadLogbooks,
      patch,
      prepareReviews,
      refreshConnection,
    ],
  );

  const setLicense = useCallback(
    (license: PageLicense) => {
      patch({
        license,
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const setSlug = useCallback(
    (slug: string) => {
      patch({
        slug,
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const setPublicLogbookId = useCallback(
    (publicLogbookId: string) => {
      patch({
        publicLogbookId,
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const selectEvidence = useCallback(
    (refs: string[]) => {
      patch({
        selectedEvidenceRefs: [...refs],
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const setSourceLinks = useCallback(
    (sourceLinks: SourceLinkV1[]) => {
      patch({
        sourceLinks,
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const setIncludeSourceDate = useCallback(
    (includeSourceDate: boolean) => {
      patch({
        includeSourceDate,
        finalized: undefined,
        phase:
          stateRef.current.phase === "finalized"
            ? "editing"
            : stateRef.current.phase,
        acknowledgeWarnings: false,
      });
    },
    [patch],
  );

  const setAcknowledgeWarnings = useCallback(
    (acknowledgeWarnings: boolean) => {
      patch({ acknowledgeWarnings });
      if (
        acknowledgeWarnings &&
        stateRef.current.finalized?.decision === "needs_review"
      ) {
        queueMicrotask(() => {
          void finalizeReviewRef.current?.();
        });
      }
    },
    [patch],
  );

  const buildEvidenceSelections =
    useCallback((): MastheadPagesEvidenceSelection[] => {
      const current = stateRef.current;
      return current.selectedEvidenceRefs.map((ref) => {
        const candidate = current.evidenceCandidates.find(
          (item) => item.ref === ref,
        );
        if (!candidate) {
          return {
            ref,
            kind: "excerpt" as const,
            label: ref,
            supports: ["outcome"],
          };
        }
        return {
          ref: candidate.ref,
          kind: defaultKind(candidate),
          label: candidate.label?.trim() || candidate.toolName || candidate.ref,
          supports: defaultSupports(candidate),
        };
      });
    }, []);

  const finalizeReview = useCallback(async () => {
    const current = stateRef.current;
    if (!current.artifactId) return;
    if (
      current.gate === "desktop_unavailable" ||
      current.gate === "disconnected" ||
      current.gate === "secure_storage_unavailable" ||
      current.gate === "non_publisher" ||
      current.gate === "ineligible"
    ) {
      return;
    }
    if (!current.publicLogbookId.trim()) {
      patch({ error: "Choose a destination Public Logbook." });
      return;
    }
    if (!current.slug.trim()) {
      patch({ error: "Enter a public slug." });
      return;
    }
    const connection = current.connection;
    if (!connection || connection.status !== "connected") {
      patch({
        gate: "disconnected",
        error: "Connect Masthead Pages before publishing.",
      });
      return;
    }

    patch({
      phase: "finalizing",
      error: undefined,
      outcome: { kind: "idle" },
      parentConflictObjectId: undefined,
    });
    try {
      const response = (await finalizeReviews(
        {
          items: [
            {
              artifactId: current.artifactId,
              publicLogbookId: current.publicLogbookId,
              pagesAccountId: connection.account.accountId,
              slug: current.slug.trim(),
              license: current.license,
              evidenceSelections: buildEvidenceSelections(),
              sourceLinks:
                current.sourceLinks.length > 0
                  ? current.sourceLinks
                  : undefined,
              includeSourceDate: current.includeSourceDate,
              acknowledgeWarnings: current.acknowledgeWarnings,
            },
          ],
        },
        deps.baseUrl,
      )) as { ok?: boolean; items?: unknown[] };

      const finalized = parseFinalized(response.items?.[0]);
      if (finalized.decision === "blocked") {
        patch({
          phase: "finalized",
          finalized,
          releaseMapping: finalized.existingRelease ?? current.releaseMapping,
          gate: "blocked",
          error:
            "Outbound review blocked this Page. Fix findings before publishing.",
        });
        return;
      }
      if (
        finalized.decision === "needs_review" &&
        !current.acknowledgeWarnings
      ) {
        patch({
          phase: "finalized",
          finalized,
          releaseMapping: finalized.existingRelease ?? current.releaseMapping,
          gate: "needs_warning_ack",
          error: "Acknowledge warnings before publishing.",
        });
        return;
      }
      if (!finalized.staged || !finalized.request || !finalized.requestDigest) {
        patch({
          phase: "finalized",
          finalized,
          releaseMapping: finalized.existingRelease ?? current.releaseMapping,
          gate:
            finalized.decision === "needs_review"
              ? "needs_warning_ack"
              : "blocked",
          error: "Daemon did not stage a publishable request.",
        });
        return;
      }
      patch({
        phase: "finalized",
        finalized,
        releaseMapping: finalized.existingRelease ?? current.releaseMapping,
        gate: undefined,
        error: undefined,
      });
    } catch (error) {
      patch({
        phase: "editing",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [buildEvidenceSelections, deps.baseUrl, finalizeReviews, patch]);

  finalizeReviewRef.current = finalizeReview;

  const confirmPublish = useCallback(async () => {
    const current = stateRef.current;
    const finalized = current.finalized;
    if (
      !current.artifactId ||
      !finalized?.request ||
      !finalized.requestDigest ||
      !finalized.staged
    ) {
      patch({ error: "Finalize a ready review before publishing." });
      return;
    }
    if (finalized.decision === "blocked") {
      patch({ gate: "blocked", error: "Blocked Pages cannot be published." });
      return;
    }
    if (finalized.decision === "needs_review" && !current.acknowledgeWarnings) {
      patch({
        gate: "needs_warning_ack",
        error: "Acknowledge warnings before publishing.",
      });
      return;
    }
    if (!desktopAvailable()) {
      patch({
        gate: "desktop_unavailable",
        error: "Masthead Pages requires the desktop app.",
      });
      return;
    }

    if (!desktopClient.browserReviewOnly) {
      const recomputed = await sha256CanonicalRequest(finalized.request);
      if (recomputed !== finalized.requestDigest) {
        patch({
          phase: "editing",
          finalized: undefined,
          error:
            "Outbound request digest changed. Re-run review before publishing.",
        });
        return;
      }
    }

    const previousExactUrl = current.releaseMapping?.exactUrl;
    patch({
      phase: "publishing",
      outcome: { kind: "publishing" },
      error: undefined,
    });
    try {
      const batch = (await desktopClient.publishStaged([
        {
          artifactId: current.artifactId,
          requestDigest: finalized.requestDigest,
        },
      ])) as PublishPageBatchResultV1;
      const result = batch.results?.[0];
      if (!result) {
        throw new Error("Hosted publish returned no itemized result.");
      }

      if (isSuccessResult(result)) {
        const contentFingerprint = current.prepared?.contentFingerprint ?? "";
        const connection = current.connection;
        const pagesAccountId =
          connection && connection.status === "connected"
            ? connection.account.accountId
            : "";
        if (!desktopClient.browserReviewOnly)
          await recordResults(
            {
              kind: "publication",
              receipt: {
                artifactId: current.artifactId,
                pageId: result.pageId,
                objectId: result.objectId,
                parentObjectId: result.parentObjectId,
                pagesAccountId,
                publicLogbookId: finalized.request.publicLogbookId,
                localContentFingerprint: contentFingerprint,
                egressFingerprint: finalized.requestDigest,
                friendlyUrl: result.currentUrl,
                exactUrl: result.exactRevisionUrl,
                publishedAt: result.publishedAt,
              },
            },
            deps.baseUrl,
          );
        const outcome: MastheadPagesPublicationOutcome = {
          kind: "published",
          result,
          friendlyUrl: result.currentUrl,
          exactUrl: result.exactRevisionUrl,
          ...(previousExactUrl && previousExactUrl !== result.exactRevisionUrl
            ? { previousExactUrl }
            : {}),
        };
        patch({
          phase: "complete",
          outcome,
          error: undefined,
          parentConflictObjectId: undefined,
          releaseMapping: {
            status: "live",
            pageId: result.pageId,
            objectId: result.objectId,
            parentObjectId: result.parentObjectId,
            friendlyUrl: result.currentUrl,
            exactUrl: result.exactRevisionUrl,
            localContentFingerprint: contentFingerprint,
            publicLogbookId: finalized.request.publicLogbookId,
          },
          finalized: {
            ...finalized,
            staged: false,
          },
        });
        return;
      }

      const parentConflictObjectId =
        result.code === "parent-conflict" &&
        typeof result.currentObjectId === "string"
          ? result.currentObjectId
          : undefined;

      await recordResults(
        {
          kind: "failure",
          failure: {
            artifactId: current.artifactId,
            errorClass: result.code,
            message: result.message,
            retryable:
              result.retryable === true && result.code !== "parent-conflict",
            recordedAt: now(),
            currentObjectId: result.currentObjectId,
          },
        },
        deps.baseUrl,
      );

      if (parentConflictObjectId) {
        patch({
          phase: "editing",
          finalized: undefined,
          parentConflictObjectId,
          gate: "parent_conflict",
          outcome: {
            kind: "failed",
            message: PARENT_CONFLICT_COPY,
            retryable: false,
            code: result.code,
            result,
            parentConflictObjectId,
          },
          error: PARENT_CONFLICT_COPY,
          releaseMapping: {
            ...(current.releaseMapping ?? { status: "live" as const }),
            status:
              current.releaseMapping?.status === "live"
                ? "live"
                : (current.releaseMapping?.status ?? "failed"),
            objectId: parentConflictObjectId,
            lastErrorClass: "parent-conflict",
            lastErrorMessage: result.message,
          },
        });
        return;
      }

      patch({
        phase: "finalized",
        outcome: {
          kind: "failed",
          message: result.message,
          retryable: result.retryable === true,
          code: result.code,
          result,
        },
        error: result.message,
        releaseMapping: {
          ...(current.releaseMapping ?? { status: "none" as const }),
          pendingOperationKind:
            result.retryable === true ? "publish" : undefined,
          pendingRequestDigest:
            result.retryable === true ? finalized.requestDigest : undefined,
          pendingIdempotencyKey:
            result.retryable === true
              ? finalized.request.idempotencyKey
              : undefined,
          lastErrorClass: result.code,
          lastErrorMessage: result.message,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await recordResults(
          {
            kind: "failure",
            failure: {
              artifactId: current.artifactId,
              errorClass: "hosted_transport_error",
              message,
              retryable: true,
              recordedAt: now(),
            },
          },
          deps.baseUrl,
        );
      } catch {
        // Recording failure must not mask the publish error.
      }
      patch({
        phase: "finalized",
        outcome: { kind: "failed", message, retryable: true },
        error: message,
        releaseMapping: {
          ...(current.releaseMapping ?? { status: "none" as const }),
          pendingOperationKind: "publish",
          pendingRequestDigest: finalized.requestDigest,
          pendingIdempotencyKey: finalized.request.idempotencyKey,
          lastErrorClass: "hosted_transport_error",
          lastErrorMessage: message,
        },
      });
    }
  }, [
    deps.baseUrl,
    desktopAvailable,
    desktopClient,
    now,
    patch,
    recordResults,
  ]);

  const retryPendingPublication = useCallback(
    async (artifactId?: string) => {
      const id = artifactId ?? stateRef.current.artifactId;
      if (!id) {
        patch({ error: "No artifact selected for publication retry." });
        return;
      }
      if (!desktopAvailable()) {
        patch({
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app.",
        });
        return;
      }

      patch({
        phase: "publishing",
        outcome: { kind: "publishing" },
        error: undefined,
        artifactId: id,
      });
      try {
        const pendingRaw = (await getPendingOperation(id, deps.baseUrl)) as {
          operation?: {
            operationKind?: string;
            requestDigest?: string;
            idempotencyKey?: string;
            requestJson?: string;
          };
        };
        const operation = pendingRaw.operation;
        if (
          !operation ||
          operation.operationKind !== "publish" ||
          !operation.requestDigest
        ) {
          patch({
            phase: "editing",
            outcome: {
              kind: "failed",
              message: "No staged publication to retry.",
              retryable: false,
            },
            error: "No staged publication to retry. Run outbound review again.",
          });
          return;
        }

        if (operation.requestJson) {
          const parsed = JSON.parse(
            operation.requestJson,
          ) as PublishPageRequestV1;
          const recomputed = desktopClient.browserReviewOnly
            ? operation.requestDigest
            : await sha256CanonicalRequest(parsed);
          if (recomputed !== operation.requestDigest) {
            patch({
              phase: "editing",
              outcome: {
                kind: "failed",
                message:
                  "Staged publication digest no longer matches stored bytes.",
                retryable: false,
              },
              error:
                "Staged publication digest no longer matches stored bytes. Run outbound review again.",
            });
            return;
          }
        }

        const previousExactUrl = stateRef.current.releaseMapping?.exactUrl;
        const batch = (await desktopClient.publishStaged([
          { artifactId: id, requestDigest: operation.requestDigest },
        ])) as PublishPageBatchResultV1;
        const result = batch.results?.[0];
        if (!result)
          throw new Error("Hosted publish returned no itemized result.");

        if (isSuccessResult(result)) {
          const contentFingerprint =
            stateRef.current.prepared?.contentFingerprint ?? "";
          const connection = stateRef.current.connection;
          const pagesAccountId =
            connection && connection.status === "connected"
              ? connection.account.accountId
              : "";
          const publicLogbookId =
            stateRef.current.publicLogbookId ||
            stateRef.current.releaseMapping?.publicLogbookId ||
            "";
          if (!desktopClient.browserReviewOnly)
            await recordResults(
              {
                kind: "publication",
                receipt: {
                  artifactId: id,
                  pageId: result.pageId,
                  objectId: result.objectId,
                  parentObjectId: result.parentObjectId,
                  pagesAccountId,
                  publicLogbookId,
                  localContentFingerprint: contentFingerprint,
                  egressFingerprint: operation.requestDigest,
                  friendlyUrl: result.currentUrl,
                  exactUrl: result.exactRevisionUrl,
                  publishedAt: result.publishedAt,
                },
              },
              deps.baseUrl,
            );
          patch({
            phase: "complete",
            outcome: {
              kind: "published",
              result,
              friendlyUrl: result.currentUrl,
              exactUrl: result.exactRevisionUrl,
              ...(previousExactUrl &&
              previousExactUrl !== result.exactRevisionUrl
                ? { previousExactUrl }
                : {}),
            },
            releaseMapping: {
              status: "live",
              pageId: result.pageId,
              objectId: result.objectId,
              friendlyUrl: result.currentUrl,
              exactUrl: result.exactRevisionUrl,
              localContentFingerprint: contentFingerprint,
              publicLogbookId,
            },
            error: undefined,
          });
          return;
        }

        await recordResults(
          {
            kind: "failure",
            failure: {
              artifactId: id,
              errorClass: result.code,
              message: result.message,
              retryable: result.retryable === true,
              recordedAt: now(),
              currentObjectId: result.currentObjectId,
            },
          },
          deps.baseUrl,
        );
        patch({
          phase: "finalized",
          outcome: {
            kind: "failed",
            message: result.message,
            retryable: result.retryable === true,
            code: result.code,
            result,
          },
          error: result.message,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patch({
          phase: "editing",
          outcome: { kind: "failed", message, retryable: true },
          error: message,
        });
      }
    },
    [
      deps.baseUrl,
      desktopAvailable,
      desktopClient,
      getPendingOperation,
      now,
      patch,
      recordResults,
    ],
  );

  const beginRemoval = useCallback(() => {
    const mapping =
      stateRef.current.releaseMapping ??
      stateRef.current.prepared?.existingRelease;
    if (!canRemoveFromPages(mapping)) {
      patch({
        error: "No live Masthead Pages mapping is available to remove.",
      });
      return;
    }
    patch({ removalConfirmOpen: true, error: undefined });
  }, [patch]);

  const cancelRemoval = useCallback(() => {
    patch({ removalConfirmOpen: false });
  }, [patch]);

  const confirmRemoval = useCallback(
    async (stagedDigest?: string) => {
      const current = stateRef.current;
      const artifactId = current.artifactId;
      if (!artifactId) return;
      if (!desktopAvailable()) {
        patch({
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app.",
        });
        return;
      }

      patch({
        phase: "removing",
        outcome: { kind: "removing" },
        error: undefined,
        removalConfirmOpen: false,
      });
      try {
        let requestDigest =
          stagedDigest ||
          (current.releaseMapping?.pendingOperationKind === "remove"
            ? current.releaseMapping.pendingRequestDigest
            : undefined);
        if (!requestDigest) {
          const staged = (await stageRemoval({ artifactId }, deps.baseUrl)) as {
            requestDigest?: string;
            mapping?: ExistingReleaseSnapshot;
          };
          requestDigest = staged.requestDigest;
          if (staged.mapping) {
            patch({
              releaseMapping:
                parseReleaseMapping(staged.mapping) ?? staged.mapping,
            });
          }
        }
        if (!requestDigest) {
          throw new Error("Daemon did not stage a removal request.");
        }

        const result = (await desktopClient.withdrawStaged({
          artifactId,
          requestDigest,
        })) as RemovePageResultV1;

        if (
          result.status === "removed" ||
          result.status === "idempotent-replay"
        ) {
          await recordResults(
            {
              kind: "removed",
              artifactId,
              removedAt: result.removedAt ?? now(),
            },
            deps.baseUrl,
          );
          patch({
            phase: "complete",
            outcome: { kind: "removed", result, message: result.message },
            releaseMapping: {
              ...(current.releaseMapping ?? { status: "removed" as const }),
              status: "removed",
              pageId: result.pageId || current.releaseMapping?.pageId,
            },
            error: undefined,
          });
          return;
        }

        await recordResults(
          {
            kind: "failure",
            failure: {
              artifactId,
              errorClass: result.code ?? "removal_failed",
              message: result.message ?? "Removal failed",
              retryable: result.retryable === true,
              recordedAt: now(),
            },
          },
          deps.baseUrl,
        );
        patch({
          phase: "editing",
          outcome: {
            kind: "failed",
            message: result.message ?? "Removal failed",
            retryable: result.retryable === true,
            code: result.code,
            result,
          },
          error: result.message ?? "Removal failed",
          releaseMapping: {
            ...(current.releaseMapping ?? { status: "live" as const }),
            pendingOperationKind:
              result.retryable === true ? "remove" : undefined,
            pendingRequestDigest:
              result.retryable === true ? requestDigest : undefined,
            lastErrorClass: result.code ?? "removal_failed",
            lastErrorMessage: result.message,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patch({
          phase: "editing",
          outcome: { kind: "failed", message, retryable: true },
          error: message,
        });
      }
    },
    [
      deps.baseUrl,
      desktopAvailable,
      desktopClient,
      now,
      patch,
      recordResults,
      stageRemoval,
    ],
  );

  const retryPendingRemoval = useCallback(
    async (artifactId?: string) => {
      const id = artifactId ?? stateRef.current.artifactId;
      if (!id) return;
      if (!desktopAvailable()) {
        patch({
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app.",
        });
        return;
      }
      patch({
        artifactId: id,
        removalConfirmOpen: false,
        phase: "removing",
        outcome: { kind: "removing" },
        error: undefined,
      });
      try {
        const pendingRaw = (await getPendingOperation(id, deps.baseUrl)) as {
          operation?: { operationKind?: string; requestDigest?: string };
        };
        const operation = pendingRaw.operation;
        if (
          !operation ||
          operation.operationKind !== "remove" ||
          !operation.requestDigest
        ) {
          patch({
            phase: "editing",
            outcome: {
              kind: "failed",
              message: "No staged removal to retry.",
              retryable: false,
            },
            error: "No staged removal to retry.",
          });
          return;
        }
        await confirmRemoval(operation.requestDigest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patch({
          phase: "editing",
          outcome: { kind: "failed", message, retryable: true },
          error: message,
        });
      }
    },
    [
      confirmRemoval,
      deps.baseUrl,
      desktopAvailable,
      getPendingOperation,
      patch,
    ],
  );

  const canConfirmPublish = useMemo(() => {
    const finalized = state.finalized;
    if (
      state.phase !== "finalized" ||
      !finalized?.staged ||
      !finalized.requestDigest
    )
      return false;
    if (finalized.decision === "blocked") return false;
    if (finalized.decision === "needs_review" && !state.acknowledgeWarnings)
      return false;
    if (state.gate && state.gate !== "needs_warning_ack") return false;
    if (finalized.decision === "needs_review" && state.acknowledgeWarnings)
      return true;
    return finalized.decision === "ready";
  }, [state.acknowledgeWarnings, state.finalized, state.gate, state.phase]);

  const previewObject =
    state.finalized?.request?.object ?? state.prepared?.baseObject;
  const previewRequest = state.finalized?.request;
  const findings: EgressFinding[] =
    state.finalized?.findings ?? state.prepareFindings;
  const mapping = state.releaseMapping;
  const canRetryPublish = canRetryPendingPublication(mapping);
  const canRetryRemove = canRetryPendingRemoval(mapping);
  const canRemove = canRemoveFromPages(mapping);

  const batchReadyCount = useMemo(
    () =>
      batchState.items.filter(
        (item) =>
          item.selectedForPublish &&
          item.finalized?.decision === "ready" &&
          item.finalized.staged,
      ).length,
    [batchState.items],
  );

  return {
    state,
    phase: state.phase as MastheadPagesReviewPhase,
    batchState,
    batchReadyCount,
    openSingleReview,
    openBatchReview,
    closeReview,
    closeBatchReview,
    connect,
    disconnect,
    refreshConnection,
    loadLogbooks,
    setLicense,
    setSlug,
    setPublicLogbookId,
    selectEvidence,
    setSourceLinks,
    setIncludeSourceDate,
    setAcknowledgeWarnings,
    setBatchLicense,
    setBatchPublicLogbookId,
    setBatchAcknowledgeWarnings,
    setBatchItemSelectedForPublish,
    finalizeBatchReview,
    confirmBatchPublish,
    finalizeReview,
    confirmPublish,
    retryPendingPublication,
    beginRemoval,
    cancelRemoval,
    confirmRemoval,
    retryPendingRemoval,
    canConfirmPublish,
    canRetryPublish,
    canRetryRemove,
    canRemove,
    previewObject,
    previewRequest,
    findings,
    desktopClient,
  };
}

export type UseMastheadPagesControllerResult = ReturnType<
  typeof useMastheadPagesController
>;
