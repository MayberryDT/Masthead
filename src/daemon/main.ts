import { daemonConfigFromEnv } from "./config.ts";
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
