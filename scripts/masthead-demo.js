#!/usr/bin/env node
import http from "node:http";

const ingestUrl = process.env.MASTHEAD_INGEST_URL || "http://127.0.0.1:17373/ingest";

const sampleHookPayload = {
  provider_event_id: `demo-${Date.now()}`,
  event: "command_finished",
  session_id: "demo-codex-session",
  timestamp: new Date().toISOString(),
  cwd: process.cwd(),
  project: "Masthead",
  title: "Demo hook payload",
  command_id: "demo-command",
  command: "npm test -- --run src/core/__tests__/codexAdapter.test.ts",
  exit_code: 0,
  category: "test",
  summary: "Demo verification completed"
};

postJson(ingestUrl, sampleHookPayload)
  .then((body) => {
    console.log(`Posted demo hook payload to ${ingestUrl}`);
    console.log(body);
    console.log("Try the fixture endpoint on the ingest server: http://127.0.0.1:17373/fixture");
  })
  .catch((error) => {
    console.error(`Unable to post demo payload to ${ingestUrl}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

function postJson(target, payload) {
  const body = JSON.stringify(payload);
  const parsed = new URL(target);

  return new Promise((resolve, reject) => {
    const request = http.request(
      parsed,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => resolve(responseBody));
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}
