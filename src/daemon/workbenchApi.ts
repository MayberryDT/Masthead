import type { WorkbenchCanonicalDossierPublicationResponse } from "../shared/workbench.ts";
import { publishCanonicalDossiers } from "../workbench/authoring/authoringService.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

export function publishCanonicalDossiersFromWorkbenchApi(
  db: MastheadDatabase,
  body: unknown
): WorkbenchCanonicalDossierPublicationResponse {
  const input = requireRecord(body);
  for (const field of Object.keys(input)) {
    if (field !== "actorId" && field !== "sessionIds") {
      throw new Error(`invalid_request:unsupported field ${field}`);
    }
  }
  const actorId = requireNonBlankString(input.actorId, "actorId");
  const sessionIds = requireSessionIds(input.sessionIds);
  return {
    ok: true,
    receipt: publishCanonicalDossiers(db, { actorId, sessionIds })
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_request:request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requireNonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid_request:${field} is required`);
  return value.trim();
}

function requireSessionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("invalid_request:sessionIds must be a non-empty array");
  }
  return value.map((sessionId) => requireNonBlankString(sessionId, "sessionIds[]"));
}
