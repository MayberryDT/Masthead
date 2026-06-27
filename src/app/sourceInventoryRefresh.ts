export function shouldRefreshSourceInventory(input: {
  activeSurface: string;
  force?: boolean;
  lastLoadedAt?: number;
  now: number;
  ttlMs?: number;
}): boolean {
  if (input.activeSurface !== "sources") return false;
  if (input.force) return true;
  if (input.lastLoadedAt === undefined) return true;
  return input.now - input.lastLoadedAt >= (input.ttlMs ?? 10_000);
}
