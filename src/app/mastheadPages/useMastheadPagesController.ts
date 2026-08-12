import { useCallback, useMemo, useRef, useState } from "react";
import type { EgressFinding } from "../../mastheadPages/egressPreflight";
import type {
  PageLicense,
  PublishPageBatchResultV1,
  PublishPageRequestV1,
  PublishPageResultV1,
  PublicLogbookSummaryV1,
  SourceLinkV1
} from "../../mastheadPages/types";
import {
  finalizeAndStageMastheadPagesReviews,
  prepareMastheadPagesReviews,
  recordMastheadPagesResults
} from "../daemonClient";
import type { MastheadPagesConnectionState } from "../desktopBridge";
import {
  createMastheadPagesDesktopClient,
  isMastheadPagesDesktopClientAvailable,
  type MastheadPagesDesktopClient
} from "./desktopClient";
import { sha256CanonicalRequest } from "./requestDigest";
import type {
  FinalizedPageReviewItem,
  MastheadPagesEvidenceCandidate,
  MastheadPagesEvidenceSelection,
  MastheadPagesPublicationOutcome,
  MastheadPagesReviewPhase,
  MastheadPagesReviewState,
  PreparedPageReviewItem
} from "./types";

export type MastheadPagesControllerDeps = {
  baseUrl: string;
  desktopClient?: MastheadPagesDesktopClient;
  desktopAvailable?: () => boolean;
  prepareReviews?: typeof prepareMastheadPagesReviews;
  finalizeReviews?: typeof finalizeAndStageMastheadPagesReviews;
  recordResults?: typeof recordMastheadPagesResults;
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
  outcome: { kind: "idle" }
});

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "page";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parsePrepared(raw: unknown): PreparedPageReviewItem {
  const row = asRecord(raw);
  return {
    artifactId: String(row.artifactId ?? ""),
    eligibility: row.eligibility === "eligible" ? "eligible" : "ineligible",
    ineligibilityReason: typeof row.ineligibilityReason === "string" ? row.ineligibilityReason : undefined,
    evidenceCandidates: Array.isArray(row.evidenceCandidates)
      ? (row.evidenceCandidates as MastheadPagesEvidenceCandidate[])
      : [],
    findings: Array.isArray(row.findings) ? (row.findings as EgressFinding[]) : [],
    title: typeof row.title === "string" ? row.title : undefined,
    contentFingerprint: typeof row.contentFingerprint === "string" ? row.contentFingerprint : undefined,
    lineageId: typeof row.lineageId === "string" ? row.lineageId : undefined,
    baseObject: row.baseObject,
    existingRelease:
      row.existingRelease && typeof row.existingRelease === "object"
        ? (row.existingRelease as PreparedPageReviewItem["existingRelease"])
        : undefined
  };
}

function parseFinalized(raw: unknown): FinalizedPageReviewItem {
  const row = asRecord(raw);
  return {
    artifactId: String(row.artifactId ?? ""),
    decision:
      row.decision === "ready" || row.decision === "needs_review" || row.decision === "blocked"
        ? row.decision
        : "blocked",
    findings: Array.isArray(row.findings) ? (row.findings as EgressFinding[]) : [],
    request: row.request as PublishPageRequestV1 | undefined,
    requestDigest: typeof row.requestDigest === "string" ? (row.requestDigest as FinalizedPageReviewItem["requestDigest"]) : undefined,
    staged: row.staged === true,
    existingRelease:
      row.existingRelease && typeof row.existingRelease === "object"
        ? (row.existingRelease as PreparedPageReviewItem["existingRelease"])
        : undefined
  };
}

function defaultSupports(candidate: MastheadPagesEvidenceCandidate): string[] {
  if (candidate.kind === "verification" || candidate.role === "verification") return ["verification"];
  return ["summary"];
}

function defaultKind(candidate: MastheadPagesEvidenceCandidate): "excerpt" | "verification" {
  if (candidate.kind === "verification" || candidate.role === "verification") return "verification";
  return "excerpt";
}

function connectionGate(connection: MastheadPagesConnectionState | undefined): MastheadPagesReviewState["gate"] {
  if (!connection) return "disconnected";
  if (connection.status === "disconnected") return "disconnected";
  if (connection.status === "secure_storage_unavailable") return "secure_storage_unavailable";
  if (connection.status === "connected" && connection.account.publisherAccess !== "publisher") {
    return "non_publisher";
  }
  return undefined;
}

function isSuccessResult(result: PublishPageResultV1): result is Extract<PublishPageResultV1, { status: "published" | "idempotent-replay" }> {
  return result.status === "published" || result.status === "idempotent-replay";
}

export function useMastheadPagesController(deps: MastheadPagesControllerDeps) {
  const [state, setState] = useState<MastheadPagesReviewState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const finalizeReviewRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const desktopAvailable = deps.desktopAvailable ?? isMastheadPagesDesktopClientAvailable;
  const desktopClient = useMemo(
    () => deps.desktopClient ?? createMastheadPagesDesktopClient(),
    [deps.desktopClient]
  );
  const prepareReviews = deps.prepareReviews ?? prepareMastheadPagesReviews;
  const finalizeReviews = deps.finalizeReviews ?? finalizeAndStageMastheadPagesReviews;
  const recordResults = deps.recordResults ?? recordMastheadPagesResults;
  const now = deps.now ?? (() => new Date().toISOString());

  const patch = useCallback((update: Partial<MastheadPagesReviewState> | ((current: MastheadPagesReviewState) => MastheadPagesReviewState)) => {
    setState((current) => {
      const next = typeof update === "function" ? update(current) : { ...current, ...update };
      stateRef.current = next;
      return next;
    });
  }, []);

  const refreshConnection = useCallback(async (): Promise<MastheadPagesConnectionState | undefined> => {
    if (!desktopAvailable()) {
      patch({ connection: undefined, gate: "desktop_unavailable" });
      return undefined;
    }
    try {
      const connection = await desktopClient.getConnection();
      const gate = connectionGate(connection);
      patch({ connection, gate: gate === "disconnected" || gate === "secure_storage_unavailable" || gate === "non_publisher" ? gate : undefined });
      return connection;
    } catch (error) {
      patch({
        connection: undefined,
        error: error instanceof Error ? error.message : String(error),
        gate: "desktop_unavailable"
      });
      return undefined;
    }
  }, [desktopAvailable, desktopClient, patch]);

  const loadLogbooks = useCallback(async () => {
    if (!desktopAvailable()) return [];
    try {
      const logbooks = await desktopClient.listPublicLogbooks();
      patch((current) => ({
        ...current,
        logbooks,
        publicLogbookId: current.publicLogbookId || logbooks[0]?.id || ""
      }));
      return logbooks;
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }, [desktopAvailable, desktopClient, patch]);

  const connect = useCallback(async () => {
    if (!desktopAvailable()) {
      patch({ gate: "desktop_unavailable", error: "Masthead Pages requires the desktop app." });
      return;
    }
    try {
      const connection = await desktopClient.connect();
      const gate = connectionGate(connection);
      patch({ connection, gate, error: undefined });
      if (connection.status === "connected" && connection.account.publisherAccess === "publisher") {
        await loadLogbooks();
      }
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : String(error) });
    }
  }, [desktopAvailable, desktopClient, loadLogbooks, patch]);

  const disconnect = useCallback(async () => {
    if (!desktopAvailable()) return;
    await desktopClient.disconnect();
    patch({ connection: { status: "disconnected" }, gate: "disconnected", logbooks: [] });
  }, [desktopAvailable, desktopClient, patch]);

  const closeReview = useCallback(() => {
    patch(initialState());
  }, [patch]);

  const openSingleReview = useCallback(
    async (artifactId: string) => {
      patch({
        ...initialState(),
        phase: "loading",
        artifactId,
        outcome: { kind: "idle" }
      });

      if (!desktopAvailable()) {
        patch({
          phase: "error",
          artifactId,
          gate: "desktop_unavailable",
          error: "Masthead Pages requires the desktop app."
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
                : "Publisher access is required to publish Pages."
        });
        return;
      }

      const logbooks = await loadLogbooks();

      try {
        const response = (await prepareReviews({ artifactIds: [artifactId] }, deps.baseUrl)) as {
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
            gate: "ineligible",
            error: prepared.ineligibilityReason
              ? `This Page is not eligible: ${prepared.ineligibilityReason}`
              : "This Page is not eligible for Masthead Pages."
          });
          return;
        }

        const defaultSlug = slugify(prepared.title ?? artifactId);
        const preferredLogbookId =
          prepared.existingRelease?.publicLogbookId ||
          logbooks[0]?.id ||
          stateRef.current.publicLogbookId ||
          "";
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
          gate: undefined,
          error: undefined,
          finalized: undefined,
          acknowledgeWarnings: false,
          outcome: { kind: "idle" }
        });
      } catch (error) {
        patch({
          phase: "error",
          artifactId,
          connection,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [deps.baseUrl, desktopAvailable, loadLogbooks, patch, prepareReviews, refreshConnection]
  );

  const setLicense = useCallback(
    (license: PageLicense) => {
      patch({ license, finalized: undefined, phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase, acknowledgeWarnings: false });
    },
    [patch]
  );

  const setSlug = useCallback(
    (slug: string) => {
      patch({ slug, finalized: undefined, phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase, acknowledgeWarnings: false });
    },
    [patch]
  );

  const setPublicLogbookId = useCallback(
    (publicLogbookId: string) => {
      patch({
        publicLogbookId,
        finalized: undefined,
        phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase,
        acknowledgeWarnings: false
      });
    },
    [patch]
  );

  const selectEvidence = useCallback(
    (refs: string[]) => {
      patch({
        selectedEvidenceRefs: [...refs],
        finalized: undefined,
        phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase,
        acknowledgeWarnings: false
      });
    },
    [patch]
  );

  const setSourceLinks = useCallback(
    (sourceLinks: SourceLinkV1[]) => {
      patch({
        sourceLinks,
        finalized: undefined,
        phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase,
        acknowledgeWarnings: false
      });
    },
    [patch]
  );

  const setIncludeSourceDate = useCallback(
    (includeSourceDate: boolean) => {
      patch({
        includeSourceDate,
        finalized: undefined,
        phase: stateRef.current.phase === "finalized" ? "editing" : stateRef.current.phase,
        acknowledgeWarnings: false
      });
    },
    [patch]
  );

  const setAcknowledgeWarnings = useCallback(
    (acknowledgeWarnings: boolean) => {
      patch({ acknowledgeWarnings });
      // Staged publish requires acknowledgeWarnings at finalize time; re-run when the human accepts warnings.
      if (acknowledgeWarnings && stateRef.current.finalized?.decision === "needs_review") {
        queueMicrotask(() => {
          void finalizeReviewRef.current?.();
        });
      }
    },
    [patch]
  );

  const buildEvidenceSelections = useCallback((): MastheadPagesEvidenceSelection[] => {
    const current = stateRef.current;
    return current.selectedEvidenceRefs.map((ref) => {
      const candidate = current.evidenceCandidates.find((item) => item.ref === ref);
      if (!candidate) {
        return {
          ref,
          kind: "excerpt" as const,
          label: ref,
          supports: ["summary"]
        };
      }
      return {
        ref: candidate.ref,
        kind: defaultKind(candidate),
        label: candidate.label?.trim() || candidate.toolName || candidate.ref,
        supports: defaultSupports(candidate)
      };
    });
  }, []);

  const finalizeReview = useCallback(async () => {
    const current = stateRef.current;
    if (!current.artifactId) return;
    if (current.gate === "desktop_unavailable" || current.gate === "disconnected" || current.gate === "secure_storage_unavailable" || current.gate === "non_publisher" || current.gate === "ineligible") {
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
      patch({ gate: "disconnected", error: "Connect Masthead Pages before publishing." });
      return;
    }

    patch({ phase: "finalizing", error: undefined, outcome: { kind: "idle" } });
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
              sourceLinks: current.sourceLinks.length > 0 ? current.sourceLinks : undefined,
              includeSourceDate: current.includeSourceDate,
              acknowledgeWarnings: current.acknowledgeWarnings
            }
          ]
        },
        deps.baseUrl
      )) as { ok?: boolean; items?: unknown[] };

      const finalized = parseFinalized(response.items?.[0]);
      if (finalized.decision === "blocked") {
        patch({
          phase: "finalized",
          finalized,
          gate: "blocked",
          error: "Outbound review blocked this Page. Fix findings before publishing."
        });
        return;
      }
      if (finalized.decision === "needs_review" && !current.acknowledgeWarnings) {
        patch({
          phase: "finalized",
          finalized,
          gate: "needs_warning_ack",
          error: "Acknowledge warnings before publishing."
        });
        return;
      }
      if (!finalized.staged || !finalized.request || !finalized.requestDigest) {
        patch({
          phase: "finalized",
          finalized,
          gate: finalized.decision === "needs_review" ? "needs_warning_ack" : "blocked",
          error: "Daemon did not stage a publishable request."
        });
        return;
      }
      patch({
        phase: "finalized",
        finalized,
        gate: undefined,
        error: undefined
      });
    } catch (error) {
      patch({
        phase: "editing",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, [buildEvidenceSelections, deps.baseUrl, finalizeReviews, patch]);

  finalizeReviewRef.current = finalizeReview;

  const confirmPublish = useCallback(async () => {
    const current = stateRef.current;
    const finalized = current.finalized;
    if (!current.artifactId || !finalized?.request || !finalized.requestDigest || !finalized.staged) {
      patch({ error: "Finalize a ready review before publishing." });
      return;
    }
    if (finalized.decision === "blocked") {
      patch({ gate: "blocked", error: "Blocked Pages cannot be published." });
      return;
    }
    if (finalized.decision === "needs_review" && !current.acknowledgeWarnings) {
      patch({ gate: "needs_warning_ack", error: "Acknowledge warnings before publishing." });
      return;
    }
    if (!desktopAvailable()) {
      patch({ gate: "desktop_unavailable", error: "Masthead Pages requires the desktop app." });
      return;
    }

    // Never transfer until the controller still holds the exact staged request.
    const recomputed = await sha256CanonicalRequest(finalized.request);
    if (recomputed !== finalized.requestDigest) {
      patch({
        phase: "editing",
        finalized: undefined,
        error: "Outbound request digest changed. Re-run review before publishing."
      });
      return;
    }

    patch({ phase: "publishing", outcome: { kind: "publishing" }, error: undefined });
    try {
      const batch = (await desktopClient.publishStaged([
        { artifactId: current.artifactId, requestDigest: finalized.requestDigest }
      ])) as PublishPageBatchResultV1;
      const result = batch.results?.[0];
      if (!result) {
        throw new Error("Hosted publish returned no itemized result.");
      }

      if (isSuccessResult(result)) {
        const contentFingerprint = current.prepared?.contentFingerprint ?? "";
        const connection = current.connection;
        const pagesAccountId =
          connection && connection.status === "connected" ? connection.account.accountId : "";
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
              publishedAt: result.publishedAt
            }
          },
          deps.baseUrl
        );
        const outcome: MastheadPagesPublicationOutcome = {
          kind: "published",
          result,
          friendlyUrl: result.currentUrl,
          exactUrl: result.exactRevisionUrl
        };
        patch({
          phase: "complete",
          outcome,
          error: undefined,
          finalized: {
            ...finalized,
            staged: false
          }
        });
        return;
      }

      await recordResults(
        {
          kind: "failure",
          failure: {
            artifactId: current.artifactId,
            errorClass: result.code,
            message: result.message,
            retryable: result.retryable === true,
            recordedAt: now(),
            currentObjectId: result.currentObjectId
          }
        },
        deps.baseUrl
      );
      patch({
        phase: "finalized",
        outcome: {
          kind: "failed",
          message: result.message,
          retryable: result.retryable === true,
          code: result.code,
          result
        },
        error: result.message
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
              recordedAt: now()
            }
          },
          deps.baseUrl
        );
      } catch {
        // Recording failure must not mask the publish error.
      }
      patch({
        phase: "finalized",
        outcome: { kind: "failed", message, retryable: true },
        error: message
      });
    }
  }, [deps.baseUrl, desktopAvailable, desktopClient, now, patch, recordResults]);

  const canConfirmPublish = useMemo(() => {
    const finalized = state.finalized;
    if (state.phase !== "finalized" || !finalized?.staged || !finalized.requestDigest) return false;
    if (finalized.decision === "blocked") return false;
    if (finalized.decision === "needs_review" && !state.acknowledgeWarnings) return false;
    if (state.gate && state.gate !== "needs_warning_ack") return false;
    if (finalized.decision === "needs_review" && state.acknowledgeWarnings) return true;
    return finalized.decision === "ready";
  }, [state.acknowledgeWarnings, state.finalized, state.gate, state.phase]);

  const previewObject = state.finalized?.request?.object ?? state.prepared?.baseObject;
  const previewRequest = state.finalized?.request;
  const findings: EgressFinding[] = state.finalized?.findings ?? state.prepareFindings;

  return {
    state,
    phase: state.phase as MastheadPagesReviewPhase,
    openSingleReview,
    closeReview,
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
    finalizeReview,
    confirmPublish,
    canConfirmPublish,
    previewObject,
    previewRequest,
    findings,
    desktopClient
  };
}

export type UseMastheadPagesControllerResult = ReturnType<typeof useMastheadPagesController>;
