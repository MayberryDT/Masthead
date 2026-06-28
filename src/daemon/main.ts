import { daemonConfigFromEnv } from "./config.ts";
import { recordRuntimeDiagnostic, sanitizeDiagnosticValue } from "./diagnostics.ts";
import { createMastheadDaemon } from "./server.ts";

const config = daemonConfigFromEnv();
const daemon = await createMastheadDaemon(config);

daemon.server.listen(config.port, config.host, () => {
  const address = daemon.server.address();
  const boundPort = typeof address === "object" && address ? address.port : config.port;
  console.log(`Masthead ingest server listening at http://${config.host}:${boundPort}`);
  console.log(`POST hook payloads to http://${config.host}:${boundPort}/ingest`);
  console.log(`GET live projection at http://${config.host}:${boundPort}/projection`);
  console.log(`Persisting normalized events to ${config.storePath}`);
  if (config.gitRefreshMs > 0) console.log(`Refreshing known Git sessions every ${config.gitRefreshMs}ms`);
  daemon.startBackgroundHydration();
});

process.on("SIGINT", () => {
  void daemon.close().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void daemon.close().then(() => process.exit(0));
});

process.on("unhandledRejection", (reason) => {
  recordRuntimeDiagnostic({
    details: { reason: sanitizeDiagnosticValue(reason) },
    kind: "daemon_unhandled_rejection",
    message: "Daemon unhandled rejection",
    severity: "error"
  });
  void daemon.close().finally(() => process.exit(1));
});

process.on("uncaughtException", (error) => {
  recordRuntimeDiagnostic({
    details: { error: sanitizeDiagnosticValue(error) },
    kind: "daemon_uncaught_exception",
    message: "Daemon uncaught exception",
    severity: "error"
  });
  void daemon.close().finally(() => process.exit(1));
});

process.on("exit", (code) => {
  if (code === 0) return;
  console.error("[masthead] daemon process exiting", {
    code,
    uptimeMs: Math.round(process.uptime() * 1_000)
  });
});
