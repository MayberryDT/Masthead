import { describe, expect, test } from "vitest";
import { endpointProbePasses } from "../../../scripts/masthead-endpoint-matrix.js";

describe("endpoint matrix probe pass policy", () => {
  test("requires data summary to be present", () => {
    const dataSummary = { method: "GET", path: "/data/summary", label: "data summary" };

    expect(endpointProbePasses(dataSummary, "present")).toBe(true);
    expect(endpointProbePasses(dataSummary, "unexpected")).toBe(false);
    expect(endpointProbePasses(dataSummary, "missing")).toBe(false);
  });

  test("accepts not-found only for optional detail endpoints", () => {
    const optionalSessionDetail = { method: "GET", path: "/sessions/session-1", label: "session detail", allowNotFound: true };

    expect(endpointProbePasses(optionalSessionDetail, "present-empty")).toBe(true);
  });

  test("requires health to report the current compatible contract", () => {
    const health = { method: "GET", path: "/health", label: "collector health" };

    expect(endpointProbePasses(health, "current-compatible")).toBe(true);
    expect(endpointProbePasses(health, "present")).toBe(false);
  });
});
