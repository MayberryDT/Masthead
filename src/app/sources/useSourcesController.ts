import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSurface } from "../../ui/ObservabilitySidebar";
import {
  addSourceExclusion,
  approveAdapterTranscripts,
  cancelImport,
  connectSources,
  getRuntimeHookSettings,
  getSourcesSetup,
  importAdapterMetadata,
  importAdapterTranscripts,
  installRuntimeHooks,
  listAdapters,
  listAdapterSources,
  listImports,
  listSources,
  previewSourcesImport,
  repairSources,
  retryImport,
  runSourcesSetup,
  scanSources,
  scanSourcesSetup,
  syncAdapter,
  syncSources,
  testRuntimeHooks,
  uninstallRuntimeHooks,
  type AdapterStatus,
  type CodexHookSettingsDto,
  type ImportJob,
  type ImportJobPage,
  type SourceStatus,
  type SourcesImportPreview,
  type SourcesSetupDto,
  type SourcesSetupRunRequest
} from "../daemonClient";
import { shouldRefreshSourceInventory } from "../sourceInventoryRefresh";

type ImportPageState = Pick<ImportJobPage, "limit" | "offset" | "total">;
type HookAction = "install" | "test" | "uninstall";


type UseSourcesControllerInput = {
  activeProjectionUrl: string;
  activeSurface: AppSurface;
  isLive: boolean;
  onLibraryChanged: () => void;
};

function mergeImportRows(activeImports: ImportJob[], historyImports: ImportJob[]): ImportJob[] {
  const rows = new Map<string, ImportJob>();
  for (const job of [...activeImports, ...historyImports]) {
    if (!rows.has(job.importJobId)) rows.set(job.importJobId, job);
  }
  return Array.from(rows.values());
}

function importActionStatus(
  label: string,
  result: { imported?: number; importJobId?: string; job?: ImportJob; jobs?: ImportJob[]; queued?: number; sources?: number }
): string {
  const queued = result.queued ?? result.jobs?.length ?? (result.job || result.importJobId ? 1 : 0);
  const sourcesCount = result.sources ?? result.jobs?.length ?? (result.job || result.importJobId ? 1 : 0);
  if (queued > 0) return `${label} queued: ${queued} job${queued === 1 ? "" : "s"} across ${sourcesCount} source${sourcesCount === 1 ? "" : "s"}.`;
  if (typeof result.imported === "number") return `${label} complete: ${result.imported} records from ${sourcesCount} source${sourcesCount === 1 ? "" : "s"}.`;
  return `${label} requested.`;
}

export function useSourcesController({ activeProjectionUrl, activeSurface, isLive, onLibraryChanged }: UseSourcesControllerInput) {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [setup, setSetup] = useState<SourcesSetupDto>();
  const [importPage, setImportPage] = useState<ImportPageState>({ limit: 50, offset: 0, total: 0 });
  const [importFilterRuntime, setImportFilterRuntime] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [hookActionBusy, setHookActionBusy] = useState(false);
  const [hooks, setHooks] = useState<CodexHookSettingsDto>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string>();
  const [status, setStatus] = useState<string>();
  const inventoryLoadedAtRef = useRef<number | undefined>(undefined);
  const inventoryLoadedForUrlRef = useRef<string | undefined>(undefined);
  const inventoryLoadInFlightRef = useRef(false);

  const loadImportsForRuntime = useCallback(async (runtime?: string) => {
    const [history, active] = await Promise.all([
      listImports(activeProjectionUrl, { adapterId: runtime, limit: importPage.limit, offset: 0 }),
      listImports(activeProjectionUrl, { adapterId: runtime, limit: 50, offset: 0, status: "active" })
    ]);
    const mergedImports = mergeImportRows(active.imports, history.imports);
    setImports(mergedImports);
    setImportPage({
      limit: history.limit,
      offset: history.offset,
      total: Math.max(history.total, active.imports.length + history.imports.length)
    });
    setImportFilterRuntime(runtime);
    return {
      imports: mergedImports,
      page: history
    };
  }, [activeProjectionUrl, importPage.limit]);

  const loadInventory = useCallback(async (options: { showStatus?: boolean } = {}) => {
    inventoryLoadInFlightRef.current = true;
    try {
      const [setupResult, adapterResult, sourceResult, importResult, hookResult] = await Promise.allSettled([
        getSourcesSetup(activeProjectionUrl),
        listAdapters(activeProjectionUrl, { includeLocations: false }),
        listSources(activeProjectionUrl),
        loadImportsForRuntime(importFilterRuntime),
        getRuntimeHookSettings("codex", activeProjectionUrl)
      ]);
      if (setupResult.status === "fulfilled") setSetup(setupResult.value);
      if (adapterResult.status === "fulfilled") setAdapters(adapterResult.value);
      if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
      if (hookResult.status === "fulfilled") setHooks(hookResult.value);
      if (setupResult.status === "rejected" && sourceResult.status === "rejected" && adapterResult.status === "rejected" && importResult.status === "rejected") {
        throw sourceResult.reason;
      }
      if (setupResult.status === "fulfilled" || adapterResult.status === "fulfilled" || sourceResult.status === "fulfilled" || importResult.status === "fulfilled") {
        inventoryLoadedAtRef.current = Date.now();
        inventoryLoadedForUrlRef.current = activeProjectionUrl;
        setLastRefreshAt(new Date().toISOString());
      }
      if (options.showStatus && sourceResult.status === "fulfilled") {
        setStatus(`${sourceResult.value.length} source${sourceResult.value.length === 1 ? "" : "s"} detected.`);
      }
      return {
        adapters: adapterResult.status === "fulfilled" ? adapterResult.value : undefined,
        imports: importResult.status === "fulfilled" ? importResult.value.imports : undefined,
        setup: setupResult.status === "fulfilled" ? setupResult.value : undefined,
        sources: sourceResult.status === "fulfilled" ? sourceResult.value : undefined
      };
    } finally {
      inventoryLoadInFlightRef.current = false;
    }
  }, [activeProjectionUrl, importFilterRuntime, loadImportsForRuntime]);

  const refreshSources = useCallback(async () => {
    setBusy(true);
    try {
      setStatus("Refreshing harness detection...");
      const result = await scanSourcesSetup(activeProjectionUrl);
      setSetup(result.setup);
      const scanResult = result.scan ?? result.setup.latestScan ?? result.setup.scan;
      const found = scanResult?.foundSources.filter((source) => source.importable === true || source.state === "importable").length ?? 0;
      setStatus(`Detection refresh complete: ${found} importable source${found === 1 ? "" : "s"} found.`);
      await loadInventory();
    } catch (error) {
      setStatus(`Detection refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, loadInventory]);

  const loadAdapterSources = useCallback(async (runtime: string, page: { limit: number; offset: number }) => {
    return listAdapterSources(runtime, activeProjectionUrl, page);
  }, [activeProjectionUrl]);

  const scan = useCallback(async () => {
    setBusy(true);
    setStatus("Scanning known local agent history locations...");
    try {
      const scanResult = await scanSources(activeProjectionUrl);
      const detected = scanResult.adapters.filter((adapter) => adapter.state === "connected" || adapter.state === "degraded").length;
      setStatus(`Scan complete: ${detected} adapter${detected === 1 ? "" : "s"} detected across known locations.`);
      await loadInventory();
    } catch (error) {
      setStatus(`Source scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, loadInventory]);

  const scanSetup = useCallback(async () => {
    setBusy(true);
    setStatus("Scanning known local agent history locations...");
    try {
      const result = await scanSourcesSetup(activeProjectionUrl);
      setSetup(result.setup);
      const scanResult = result.scan ?? result.setup.latestScan ?? result.setup.scan;
      const found = scanResult?.foundSources.filter((source) => source.importable === true || source.state === "importable").length ?? 0;
      setStatus(`Scan complete: ${found} importable source${found === 1 ? "" : "s"} found.`);
      await loadInventory();
      return scanResult;
    } catch (error) {
      setStatus(`Source setup scan failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, loadInventory]);

  useEffect(() => {
    if (!isLive) return;
    void loadInventory().catch((error: unknown) => {
      console.error("[masthead] Source inventory refresh failed", error);
    });
  }, [isLive, loadInventory]);

  useEffect(() => {
    if (activeSurface !== "sources") return;
    if (inventoryLoadInFlightRef.current) return;
    const lastLoadedAt = inventoryLoadedForUrlRef.current === activeProjectionUrl ? inventoryLoadedAtRef.current : undefined;
    if (!shouldRefreshSourceInventory({ activeSurface, lastLoadedAt, now: Date.now() })) return;
    void loadInventory().catch((error: unknown) => {
      setStatus(`Source inventory refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [activeProjectionUrl, activeSurface, loadInventory]);

  const pollActiveImports = useCallback(async () => {
    const activeImportIds = new Set(
      imports
        .filter((job) => job.status === "queued" || job.status === "running" || job.status === "cancelling")
        .map((job) => job.importJobId)
    );
    try {
      const result = await loadInventory();
      if (result.imports?.some((job) =>
        activeImportIds.has(job.importJobId) &&
        (job.status === "failed" || job.status === "cancelled" || job.status === "succeeded" || job.status === "succeeded_with_issues")
      )) {
        onLibraryChanged();
      }
    } catch (error) {
      console.error("[masthead] Active import poll failed", error);
    }
  }, [imports, loadInventory, onLibraryChanged]);

  const refreshAfterImportAction = useCallback(async () => {
    await loadInventory();
    onLibraryChanged();
  }, [loadInventory, onLibraryChanged]);

  const runRuntimeHookAction = useCallback(async (runtime: string, action: HookAction) => {
    const label = runtime.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    setHookActionBusy(true);
    setStatus(
      action === "install"
        ? `Installing ${label} hooks...`
        : action === "test"
          ? `Testing ${label} hooks...`
          : `Uninstalling ${label} hooks...`
    );
    try {
      const nextHooks =
        action === "install"
          ? await installRuntimeHooks(runtime, activeProjectionUrl)
          : action === "test"
            ? await testRuntimeHooks(runtime, activeProjectionUrl)
            : await uninstallRuntimeHooks(runtime, activeProjectionUrl);
      setHooks(nextHooks);
      setStatus(
        action === "install"
          ? `${label} hooks installed.`
          : action === "test"
            ? `${label} hook test complete.`
            : `${label} hooks uninstalled.`
      );
      await loadInventory();
    } catch (error) {
      setStatus(`${label} hook ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      setHookActionBusy(false);
    }
  }, [activeProjectionUrl, loadInventory]);

  const importMetadata = useCallback(async (runtime: string) => {
    setBusy(true);
    setStatus(`Importing ${runtime} metadata...`);
    try {
      const result = await importAdapterMetadata(runtime, activeProjectionUrl);
      setStatus(importActionStatus("Metadata import", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Metadata import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const enableTranscriptImport = useCallback(async (runtime: string) => {
    setBusy(true);
    setStatus(`Enabling ${runtime} transcript import...`);
    try {
      await approveAdapterTranscripts(runtime, activeProjectionUrl);
      setStatus("Transcript import enabled. Review exclusions before importing raw transcripts.");
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Transcript import approval failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const importTranscripts = useCallback(async (runtime: string) => {
    setBusy(true);
    setStatus(`Importing ${runtime} transcripts...`);
    try {
      const result = await importAdapterTranscripts(runtime, activeProjectionUrl);
      setStatus(importActionStatus("Transcript import", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Transcript import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const syncRuntime = useCallback(async (runtime: string) => {
    setBusy(true);
    setStatus(`Syncing ${runtime} source data...`);
    try {
      const result = await syncAdapter(runtime, activeProjectionUrl);
      setStatus(importActionStatus("Sync", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const connectSelected = useCallback(async (runtimes: string[]) => {
    setBusy(true);
    setStatus(`Connecting ${runtimes.length} selected adapter${runtimes.length === 1 ? "" : "s"}...`);
    try {
      const result = await connectSources(
        {
          importMetadata: true,
          importTranscripts: false,
          queueEnrichment: true,
          runtimes
        },
        activeProjectionUrl
      );
      const skipped = result.skipped?.length ?? 0;
      setStatus(
        `Connect selected queued ${result.jobs.length} job${result.jobs.length === 1 ? "" : "s"}${skipped ? `; ${skipped} adapter${skipped === 1 ? "" : "s"} skipped.` : "."}`
      );
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Connect selected failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const runSetup = useCallback(async (input: SourcesSetupRunRequest) => {
    setBusy(true);
    setStatus("Building session library...");
    try {
      const result = await runSourcesSetup(input, activeProjectionUrl);
      setSetup(result.setup);
      setStatus(importActionStatus("Session library build", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Session library build failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const previewImport = useCallback(async (input: SourcesSetupRunRequest): Promise<SourcesImportPreview[]> => {
    return previewSourcesImport(activeProjectionUrl, input);
  }, [activeProjectionUrl]);

  const syncAll = useCallback(async () => {
    setBusy(true);
    setStatus("Syncing connected sources...");
    try {
      const result = await syncSources(activeProjectionUrl);
      setSetup(result.setup);
      setStatus(importActionStatus("Sources sync", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Sources sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const repair = useCallback(async () => {
    setBusy(true);
    setStatus("Repairing missing source data...");
    try {
      const result = await repairSources(activeProjectionUrl);
      setSetup(result.setup);
      setStatus(result.repairs?.length ? `Repair queued: ${result.repairs.length} repair action${result.repairs.length === 1 ? "" : "s"}.` : importActionStatus("Repair", result));
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const cancel = useCallback(async (importJobId: string) => {
    setBusy(true);
    setStatus("Cancelling import job...");
    try {
      await cancelImport(importJobId, activeProjectionUrl);
      setStatus("Import job cancelled.");
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Import cancel failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const retry = useCallback(async (importJobId: string) => {
    setBusy(true);
    setStatus("Retrying import job...");
    try {
      await retryImport(importJobId, activeProjectionUrl);
      setStatus("Import job retry queued.");
      await refreshAfterImportAction();
    } catch (error) {
      setStatus(`Import retry failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl, refreshAfterImportAction]);

  const excludePath = useCallback(async (path: string) => {
    setBusy(true);
    try {
      await addSourceExclusion(
        {
          exclusionKind: "path",
          pattern: path,
          reason: "Excluded from full transcript ingestion."
        },
        activeProjectionUrl
      );
      setStatus("Source exclusion saved.");
      const [nextAdapters, nextSources] = await Promise.all([listAdapters(activeProjectionUrl), listSources(activeProjectionUrl)]);
      setAdapters(nextAdapters);
      setSources(nextSources);
    } catch (error) {
      setStatus(`Source exclusion failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeProjectionUrl]);

  const openImportJobsForRuntime = useCallback(async (runtime: string) => {
    setStatus(`Showing import activity for ${runtime.replaceAll("_", " ")} only.`);
    await loadImportsForRuntime(runtime);
  }, [loadImportsForRuntime]);

  const clearImportJobsFilter = useCallback(async () => {
    setStatus("Showing import activity for all runtimes.");
    await loadImportsForRuntime(undefined);
  }, [loadImportsForRuntime]);

  return {
    adapters,
    busy,
    cancel,
    clearImportJobsFilter,
    connectSelected,
    enableTranscriptImport,
    excludePath,
    hookActionBusy,
    hooks,
    importFilterRuntime,
    importMetadata,
    importPage,
    importTranscripts,
    imports,
    lastRefreshAt,
    loadAdapterSources,
    openImportJobsForRuntime,
    pollActiveImports,
    previewImport,
    refreshSources,
    repair,
    retry,
    runRuntimeHookAction,
    runSetup,
    scan,
    scanSetup,
    setup,
    sources,
    status,
    syncAll,
    syncRuntime
  };
}
