import { useEffect, useState } from "react";

export type QueryState<T> = { state: "idle" | "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

export function useMastheadQuery<T>(enabled: boolean, query: (signal: AbortSignal) => Promise<T>, deps: unknown[]): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ state: enabled ? "loading" : "idle" });

  useEffect(() => {
    if (!enabled) {
      setState({ state: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ state: "loading" });

    void query(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ state: "ready", data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ state: "error", error: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => controller.abort();
  }, deps);

  return state;
}
