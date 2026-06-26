import { afterEach, describe, expect, test, vi } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import legacyHealth from "../../../fixtures/protocol/legacy-health.json";
import { MastheadApiClient } from "../api/MastheadApiClient";
import { MastheadApiError } from "../api/MastheadApiError";

describe("MastheadApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("loads projection after compatible health", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).endsWith("/health")) return jsonResponse(currentHealth);
      return jsonResponse({ ok: true, source: "live", projection: { cards: [] } });
    });

    await expect(new MastheadApiClient("http://127.0.0.1:17374/projection").getLiveProjection()).resolves.toMatchObject({
      ok: true,
      source: "live"
    });
    expect(calls).toEqual(["http://127.0.0.1:17374/health", "http://127.0.0.1:17374/projection"]);
  });

  test("rejects legacy health before loading projection", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse(legacyHealth);
    });

    await expect(new MastheadApiClient("http://127.0.0.1:17373/projection").getLiveProjection()).rejects.toThrow(
      "missing_protocol_identity"
    );
    expect(calls).toEqual(["http://127.0.0.1:17373/health"]);
  });

  test("includes compatibility details when health is incompatible", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ ...currentHealth, apiVersion: 2 }));

    await expect(new MastheadApiClient("http://127.0.0.1:17373").getHealth()).rejects.toMatchObject({
      kind: "incompatible",
      compatibility: {
        state: "incompatible",
        reason: "unsupported_api_version",
        apiVersion: 2,
        requiredApiVersion: 1
      },
      url: "http://127.0.0.1:17373/health"
    } satisfies Partial<MastheadApiError>);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
