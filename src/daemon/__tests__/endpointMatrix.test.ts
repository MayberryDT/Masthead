import { describe, expect, test } from "vitest";
import {
  BLOCKED_MUTATION_ENDPOINTS,
  endpointProbePasses,
  READ_ONLY_ENDPOINTS,
  READ_ONLY_POST_ENDPOINTS
} from "../../../scripts/masthead-endpoint-matrix.js";

describe("endpoint matrix probe pass policy", () => {
  test("requires data summary to be present", () => {
    const dataSummary = { method: "GET", path: "/data/summary", label: "data summary" };

    expect(endpointProbePasses(dataSummary, "present")).toBe(true);
    expect(endpointProbePasses(dataSummary, "unexpected")).toBe(false);
    expect(endpointProbePasses(dataSummary, "missing")).toBe(false);
  });

  test("classifies data revisions as a canonical read", () => {
    const reads = new Set(READ_ONLY_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`));
    expect(reads).toContain("GET /data/revisions");
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

  test("classifies guided discovery, review, and legacy audit evidence as canonical reads", () => {
    const reads = new Set(READ_ONLY_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`));

    expect(reads).toContain("GET /workbench/authoring/capabilities");
    expect(reads).toContain("GET /workbench/authoring/requests/request%3Aone");
    expect(reads).toContain("GET /workbench/authoring/canaries/pending");
    expect(reads).toContain("GET /workbench/authoring/assignments/assignment%3Aone/review");
    expect(reads).toContain("GET /workbench/authoring/assignments/assignment%3Aone/scaffold");
    expect(reads).toContain("GET /workbench/authoring/assignments/assignment%3Aone/receipt");
    expect(reads).toContain("GET /workbench/authoring/runs/run-1");
    expect(reads).toContain("GET /workbench/authoring/runs/run-1/evidence?sessionId=session-1");
    expect(reads).toContain("GET /workbench/authoring/runs/run-1/context");
  });

  test("probes the artifact-only Logbook endpoint", () => {
    const reads = new Set(READ_ONLY_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`));

    expect(reads).toContain("GET /logbook/artifacts?q=Bridge");
    expect(reads).not.toContain("GET /logbook/search?q=Bridge");
  });

  test("classifies every progress-recording or mutating authoring route as primary-only", () => {
    const mutations = new Set(BLOCKED_MUTATION_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`));

    expect(mutations).toContain("GET /workbench/authoring/assignments/assignment%3Aone/inspect");
    expect(mutations).toContain("POST /workbench/authoring/suggestions");
    expect(mutations).toContain("POST /workbench/authoring/requests");
    expect(mutations).toContain("POST /workbench/authoring/requests/request%3Aone/start");
    expect(mutations).toContain("POST /workbench/authoring/assignments/assignment%3Aone/draft");
    expect(mutations).toContain("POST /workbench/authoring/requests/request%3Aone/canary-decision");
    expect(mutations).toContain("POST /workbench/authoring/assignments/assignment%3Aone/finish");
    expect(mutations).toContain("POST /workbench/authoring/runs");
    expect(mutations).toContain("POST /workbench/authoring/runs/run-1/submit");
    expect(mutations).toContain("POST /workbench/authoring/runs/run-1/finish");
  });

  test("does not classify advisory suggestions as a bridge-safe read-only POST", () => {
    const reads = new Set(READ_ONLY_POST_ENDPOINTS.map((entry) => `${entry.method} ${entry.path}`));
    expect(reads).not.toContain("POST /workbench/authoring/suggestions");
  });
});
