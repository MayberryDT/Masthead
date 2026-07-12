import { useEffect, useRef } from "react";

export function useNewItemIds(ids: readonly string[], resetKey?: unknown): ReadonlySet<string> {
  const previousIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousResetKeyRef = useRef(resetKey);
  const hasRenderedRef = useRef(false);
  const resetChanged = hasRenderedRef.current && previousResetKeyRef.current !== resetKey;
  const newIds = hasRenderedRef.current && !resetChanged
    ? new Set(ids.filter((id) => !previousIdsRef.current.has(id)))
    : new Set<string>();

  useEffect(() => {
    previousIdsRef.current = new Set(ids);
    previousResetKeyRef.current = resetKey;
    hasRenderedRef.current = true;
  }, [ids, resetKey]);

  return newIds;
}
