// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../../fixtures/protocol/current-health.json";
import { MastheadApiClient } from "../../api/MastheadApiClient";
import { MastheadConnectionProvider, type MastheadConnectionContextValue } from "../MastheadConnectionProvider";
import { useMastheadConnection } from "../useMastheadConnection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MastheadConnectionProvider helpers", () => {
  test("updates client base URL when given a projection URL", () => {
    const api = new MastheadApiClient("http://127.0.0.1:17374/projection?selectedSessionId=s1");

    expect(api.baseUrl).toBe("http://127.0.0.1:17374");
    expect(api.url("/health").toString()).toBe("http://127.0.0.1:17374/health");
    expect(api.projectionUrl("s2")).toBe("http://127.0.0.1:17374/projection?selectedSessionId=s2");
  });

  test("provides normalized base URL through context", () => {
    function Consumer() {
      const connection = useMastheadConnection();
      return <span>{`${connection.state.state}|${connection.baseUrl}|${connection.api.projectionUrl("s1")}`}</span>;
    }

    const html = renderToStaticMarkup(
      <MastheadConnectionProvider initialUrl="http://127.0.0.1:17374/projection?selectedSessionId=old">
        <Consumer />
      </MastheadConnectionProvider>
    );

    expect(html).toContain(
      "probing|http://127.0.0.1:17374|http://127.0.0.1:17374/projection?selectedSessionId=s1"
    );
  });

  test("setBaseUrl normalizes projection URLs for consumers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(currentHealth))
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest: MastheadConnectionContextValue | undefined;

    function Consumer() {
      latest = useMastheadConnection();
      return <span>{latest.baseUrl}</span>;
    }

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17374/projection">
          <Consumer />
        </MastheadConnectionProvider>
      );
    });
    expect(latest?.baseUrl).toBe("http://127.0.0.1:17374");

    await act(async () => {
      latest?.setBaseUrl("http://127.0.0.1:17375/projection?selectedSessionId=old");
    });

    expect(latest?.baseUrl).toBe("http://127.0.0.1:17375");
    expect(latest?.api.projectionUrl("s2")).toBe("http://127.0.0.1:17375/projection?selectedSessionId=s2");
    root.unmount();
  });

  test("marks bridge health as read_only when writable is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ...currentHealth,
          runtime: { ...currentHealth.runtime, mode: "read_only_bridge", writable: false }
        })
      )
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest: MastheadConnectionContextValue | undefined;

    function Consumer() {
      latest = useMastheadConnection();
      return <span>{latest.state.state}</span>;
    }

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17374/projection">
          <Consumer />
        </MastheadConnectionProvider>
      );
      await flushEffects();
    });

    expect(latest?.state.state).toBe("read_only");
    expect(latest?.writable).toBe(false);
    root.unmount();
  });

  test("does not mark daemon ready when required capabilities are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ...currentHealth,
          capabilities: ["live_projection"]
        })
      )
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    let latest: MastheadConnectionContextValue | undefined;

    function Consumer() {
      latest = useMastheadConnection();
      return <span>{latest.state.state}</span>;
    }

    await act(async () => {
      root.render(
        <MastheadConnectionProvider initialUrl="http://127.0.0.1:17374/projection">
          <Consumer />
        </MastheadConnectionProvider>
      );
      await flushEffects();
    });

    expect(latest?.state.state).toBe("incompatible");
    expect(latest?.writable).toBe(false);
    root.unmount();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
