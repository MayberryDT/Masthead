// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  classifyMastheadHealth,
  createMastheadApiClient,
  MastheadConnectionError,
  MastheadConnectionProvider,
  type MastheadConnectionContextValue
} from "../MastheadConnectionProvider";
import { useMastheadConnection } from "../useMastheadConnection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MastheadConnectionProvider helpers", () => {
  test("marks legacy health as incompatible", () => {
    expect(() => classifyMastheadHealth({ ok: true, events: 18 })).toThrow(MastheadConnectionError);
    try {
      classifyMastheadHealth({ ok: true, events: 18 });
    } catch (error) {
      expect(error).toBeInstanceOf(MastheadConnectionError);
      expect((error as MastheadConnectionError).kind).toBe("incompatible");
    }
  });

  test("marks bridge health as read_only when writable is false", () => {
    const health = classifyMastheadHealth({
      ok: true,
      product: "masthead",
      apiVersion: 1,
      runtime: { mode: "bridge", writable: false },
      data: { databaseId: "db", databasePath: "/tmp/masthead.sqlite", migrationState: "ready" }
    });

    expect(health.runtime?.writable).toBe(false);
    expect(health.runtime?.mode).toBe("bridge");
    expect(health.data?.databaseId).toBe("db");
  });

  test("updates client base URL when given a projection URL", () => {
    const api = createMastheadApiClient("http://127.0.0.1:17374/projection?selectedSessionId=s1");

    expect(api.baseUrl).toBe("http://127.0.0.1:17374");
    expect(api.healthUrl()).toBe("http://127.0.0.1:17374/health");
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
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            product: "masthead",
            apiVersion: 1,
            runtime: { mode: "primary", writable: true },
            data: { migrationState: "ready" }
          }),
          { headers: { "content-type": "application/json" } }
        )
      )
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
});
