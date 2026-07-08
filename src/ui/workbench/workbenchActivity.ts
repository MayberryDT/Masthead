export type WorkbenchActivityTone = "ok" | "info" | "warn" | "bad" | "claim" | "mute";

export function workbenchActivityTone(eventType: string): WorkbenchActivityTone {
  const t = eventType.toLowerCase();
  if (/(fail|error|denied|blocked|not_added|gate_failed|quality_failed)/.test(t)) return "bad";
  if (/(permission|warn|missing|required)/.test(t)) return "warn";
  if (/(published|quality_passed|satisfied|imported|enrichment_applied)/.test(t)) return "ok";
  if (/^claimed$|claim_heartbeat/.test(t)) return "claim";
  if (/(claim_released|legacy_backfill)/.test(t)) return "mute";
  if (/(transcript|import|check|preview|queued)/.test(t)) return "info";
  return "mute";
}

export function formatWorkbenchActivityTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}
