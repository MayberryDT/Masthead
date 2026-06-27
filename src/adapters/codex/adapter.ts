import { parseCodexTranscript } from "./transcriptParser.ts";
import { discoverCodexSources } from "./discovery.ts";
import { importCodexMetadata } from "./metadataImport.ts";
import type { DiscoveredSource, IngestCursor, SessionAdapter, SourceInventory } from "../types.ts";

export const codexAdapter: SessionAdapter = {
  runtime: "codex",
  discover: discoverCodexSources,
  async inspect(source: DiscoveredSource): Promise<SourceInventory> {
    return { failures: [], recordCount: 0, sessionCount: 0, source };
  },
  backfill(source: DiscoveredSource, cursor?: IngestCursor) {
    return source.sourceKind === "jsonl" && source.schemaVersion === "codex-transcript-jsonl"
      ? parseCodexTranscript(source, cursor)
      : importCodexMetadata(source);
  },
  async *watch() {
    return;
  }
};
