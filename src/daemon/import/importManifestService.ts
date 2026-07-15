import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredSource, IngestCursor, RuntimeKind } from "../../adapters/types.ts";
import type { ImportJobKind, ImportScopeDto, ImportWorkUnitDto, ImportWorkUnitStatus } from "../../shared/sourceImport.ts";
import {
  createImportManifest,
  createImportWorkUnit,
  type CreateImportWorkUnitInput
} from "../db/importLedgerRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { decideImportUnitScope } from "./importScope.ts";

export type PlannedImportWorkUnit = Omit<CreateImportWorkUnitInput, "importJobId" | "manifestId"> & {
  status: ImportWorkUnitStatus;
};

export type ImportManifestPlan = {
  summary: {
    manifestId: string;
    importJobId: string;
    runtime: RuntimeKind;
    sourceId?: string;
    importKind: ImportJobKind;
    scope: ImportScopeDto;
    generatedAt: string;
    totalUnits: number;
    includedUnits: number;
    cappedUnits: number;
    excludedUnits: number;
    totalBytes: number;
    estimatedRecords?: number;
  };
  units: PlannedImportWorkUnit[];
};

export async function buildImportManifestPlan(input: {
  importJobId: string;
  sourceId?: string;
  runtime: RuntimeKind;
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  generatedAt: string;
  sources: DiscoveredSource[];
  cursors?: Map<string, IngestCursor>;
}): Promise<ImportManifestPlan> {
  const candidates = await candidateUnits(input.sources, input.importKind, input.scope, input.generatedAt, input.cursors ?? new Map());
  const totalBytes = candidates.reduce((sum, unit) => sum + (unit.fileSizeBytes ?? 0), 0);
  const includedUnits = candidates.filter((unit) => unit.status !== "skipped").length;
  const cappedUnits = candidates.filter((unit) => unit.scopeReason === "deferred_by_unit_limit").length;
  return {
    summary: {
      cappedUnits,
      excludedUnits: candidates.length - includedUnits,
      generatedAt: input.generatedAt,
      importJobId: input.importJobId,
      importKind: input.importKind,
      includedUnits,
      manifestId: "",
      runtime: input.runtime,
      scope: input.scope,
      sourceId: input.sourceId,
      totalBytes,
      totalUnits: candidates.length
    },
    units: candidates
  };
}

export async function createManifestForJob(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    sourceId?: string;
    runtime: RuntimeKind;
    importKind: ImportJobKind;
    scope: ImportScopeDto;
    generatedAt: string;
    sources: DiscoveredSource[];
    cursors?: Map<string, IngestCursor>;
  }
): Promise<{ summary: ImportManifestPlan["summary"]; units: ImportWorkUnitDto[] }> {
  const plan = await buildImportManifestPlan(input);
  const summary = createImportManifest(db, {
    cappedUnits: plan.summary.cappedUnits,
    excludedUnits: plan.summary.excludedUnits,
    generatedAt: plan.summary.generatedAt,
    importJobId: plan.summary.importJobId,
    importKind: plan.summary.importKind,
    includedUnits: plan.summary.includedUnits,
    runtime: plan.summary.runtime,
    scope: plan.summary.scope,
    sourceId: plan.summary.sourceId,
    totalBytes: plan.summary.totalBytes,
    totalUnits: plan.summary.totalUnits
  });
  const units = plan.units.map((unit) =>
    createImportWorkUnit(db, {
      ...unit,
      importJobId: input.importJobId,
      manifestId: summary.manifestId
    })
  );
  return { summary, units };
}

async function candidateUnits(
  sources: DiscoveredSource[],
  importKind: ImportJobKind,
  scope: ImportScopeDto,
  generatedAt: string,
  cursors: Map<string, IngestCursor>
): Promise<PlannedImportWorkUnit[]> {
  const discovered = (await Promise.all(sources.flatMap((source) => unitsForSource(source, importKind, scope, generatedAt, cursors)))).flat();
  const units = Array.from(
    new Map(
      discovered.map((unit) => [
        `${unit.unitKind}\0${unit.sourcePath ?? unit.sourceId}\0${unit.sourceSessionId ?? ""}`,
        unit
      ])
    ).values()
  );
  const included = units
    .filter((unit) => unit.status !== "skipped")
    .toSorted((a, b) => String(b.modifiedAt ?? "").localeCompare(String(a.modifiedAt ?? "")));
  const excluded = units.filter((unit) => unit.status === "skipped");
  const appliesBoundedPage = scope.mode === "transcript_recent" && typeof scope.unitLimit === "number" && scope.unitLimit >= 0;
  const limited = appliesBoundedPage ? included.slice(0, scope.unitLimit) : included;
  const limitedIds = new Set(limited.map((unit) => `${unit.sourceId}\0${unit.sourcePath ?? ""}\0${unit.sourceSessionId ?? ""}`));
  const capped = included
    .filter((unit) => !limitedIds.has(`${unit.sourceId}\0${unit.sourcePath ?? ""}\0${unit.sourceSessionId ?? ""}`))
    .map((unit) => ({
      ...unit,
      scopeReason: "deferred_by_unit_limit" as const,
      status: "skipped" as const,
      statusReason: "Deferred by the selected recent-history range."
    }));
  return [...limited, ...capped, ...excluded].toSorted((a, b) => String(a.sourcePath ?? a.sourceId).localeCompare(String(b.sourcePath ?? b.sourceId)));
}

async function unitsForSource(
  source: DiscoveredSource,
  importKind: ImportJobKind,
  scope: ImportScopeDto,
  generatedAt: string,
  cursors: Map<string, IngestCursor>
): Promise<PlannedImportWorkUnit[]> {
  const paths = source.path ? await sourcePaths(source.path, importKind) : [undefined];
  return Promise.all(
    paths.map(async (path) => {
      const info = path ? await stat(path) : undefined;
      const modifiedAt = info?.mtime.toISOString();
      const cursor = cursorForSource(cursors, source, path);
      const scopeDecision = decideImportUnitScope({ cursor, generatedAt, scope, unit: { modifiedAt } });
      return {
        confidence: source.confidence,
        cursorBefore: cursor,
        estimatedRecords: undefined,
        fileSizeBytes: info?.size,
        modifiedAt,
        scopeReason: scopeDecision.reason,
        semanticActivityAt: undefined,
        runtime: source.runtime,
        schemaVersion: source.schemaVersion,
        sourceId: source.sourceId,
        sourceKind: source.sourceKind,
        sourcePath: path,
        status: scopeDecision.include ? "queued" : "skipped",
        statusReason: scopeDecision.include ? undefined : "Outside selected import age.",
        timestampBasis: info ? "file_modified" : "unknown",
        unitKind: importKind === "metadata" ? "metadata_source" : importKind === "enrichment" ? "enrichment_session" : "transcript_file"
      };
    })
  );
}

async function sourcePaths(path: string, importKind: ImportJobKind): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];
  if (info.isDirectory() && importKind === "transcript") return jsonlFiles(path);
  return [path];
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsonlFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function cursorForSource(cursors: Map<string, IngestCursor>, source: DiscoveredSource, path?: string): IngestCursor | undefined {
  return cursors.get(source.sourceId) ?? (path ? cursors.get(path) : undefined);
}
