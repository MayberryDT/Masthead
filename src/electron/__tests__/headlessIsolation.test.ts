import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  assertChildPrivateDisplayEnvironment,
  assertPrivateDisplayEnvironment,
  privateDisplayEnvironment,
  withPrivateDisplay
} from "../../../scripts/masthead-private-display.js";

const REAL_DESKTOP_ENV = {
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  DISPLAY: ":0",
  HOME: "/home/test",
  SESSION_MANAGER: "local/visible-desktop",
  WAYLAND_DISPLAY: "wayland-0",
  XAUTHORITY: "/home/test/.Xauthority",
  XDG_RUNTIME_DIR: "/run/user/1000",
  XDG_SESSION_ID: "7",
  XDG_SESSION_TYPE: "x11"
};

describe("private display isolation", () => {
  test("replaces every real desktop route with one attested private X display", () => {
    const session = {
      authPath: "/tmp/masthead-headless-abc/Xauthority",
      display: ":947",
      runtimeDir: "/tmp/masthead-headless-abc/runtime",
      runToken: "private-run-token-private-run-token"
    };

    const environment = privateDisplayEnvironment(REAL_DESKTOP_ENV, session);

    expect(environment).toMatchObject({
      DISPLAY: ":947",
      HOME: "/home/test",
      MASTHEAD_HEADLESS: "1",
      MASTHEAD_PRIVATE_DISPLAY: ":947",
      MASTHEAD_PRIVATE_DISPLAY_AUTHORITY: session.authPath,
      MASTHEAD_PRIVATE_DISPLAY_RUNTIME: session.runtimeDir,
      MASTHEAD_PRIVATE_DISPLAY_TOKEN: session.runToken,
      XAUTHORITY: session.authPath,
      XDG_RUNTIME_DIR: session.runtimeDir,
      XDG_SESSION_TYPE: "x11"
    });
    for (const key of ["DBUS_SESSION_BUS_ADDRESS", "SESSION_MANAGER", "WAYLAND_DISPLAY", "XDG_SESSION_ID"]) {
      expect(environment).not.toHaveProperty(key);
    }
    expect(() => assertPrivateDisplayEnvironment(environment)).not.toThrow();
    expect(() => assertPrivateDisplayEnvironment({ ...environment, DISPLAY: ":0" })).toThrow("private display");
    expect(() => assertPrivateDisplayEnvironment({ ...environment, WAYLAND_DISPLAY: "wayland-0" })).toThrow("Wayland");
    expect(() => assertChildPrivateDisplayEnvironment(
      { ...environment, DBUS_SESSION_BUS_ADDRESS: "disabled:" },
      environment
    )).not.toThrow();
    expect(() => assertChildPrivateDisplayEnvironment(
      { ...environment, DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
      environment
    )).toThrow("session bus");
  });

  test.runIf(process.platform === "linux" && process.env.MASTHEAD_HEADLESS_XVFB_TEST === "1")(
    "proves cookie-gated X isolation and removes the display plus leaked children",
    async () => {
      let display = "";
      let socketPath = "";
      let leakedPid = 0;

      const result = await withPrivateDisplay(async (session) => {
        assertPrivateDisplayEnvironment(session.environment);
        display = session.display;
        socketPath = session.socketPath;
        const probe = await run("/usr/bin/xdpyinfo", ["-display", display], session.environment);
        expect(probe.code).toBe(0);
        expect(probe.stdout).toContain(`name of display:    ${display}`);

        const leaked = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
          env: session.environment,
          stdio: "ignore"
        });
        leakedPid = leaked.pid || 0;
        leaked.unref();
        expect(leakedPid).toBeGreaterThan(0);
        return "proved";
      }, { environment: REAL_DESKTOP_ENV });

      expect(result).toBe("proved");
      await expect(access(socketPath, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(`/proc/${leakedPid}/environ`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  test.runIf(process.platform === "linux" && process.env.MASTHEAD_HEADLESS_XVFB_TEST === "1")(
    "cleans the private display when the supervised body fails",
    async () => {
      let socketPath = "";
      await expect(withPrivateDisplay(async (session) => {
        socketPath = session.socketPath;
        throw new Error("deliberate body failure");
      }, { environment: REAL_DESKTOP_ENV })).rejects.toThrow("deliberate body failure");
      await expect(access(socketPath, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  test.runIf(process.platform === "linux" && process.env.MASTHEAD_HEADLESS_XVFB_TEST === "1")(
    "cleans the private display exactly once on SIGTERM",
    async () => {
      const moduleUrl = new URL("../../../scripts/masthead-private-display.js", import.meta.url).href;
      const source = [
        `import { withPrivateDisplay } from ${JSON.stringify(moduleUrl)};`,
        "await withPrivateDisplay(async (session) => {",
        "  process.stdout.write(`${JSON.stringify({ root: session.root, socketPath: session.socketPath })}\\n`);",
        "  await new Promise(() => undefined);",
        "});"
      ].join("\n");
      const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
        env: { ...process.env, ...REAL_DESKTOP_ENV },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const line = await new Promise<string>((resolve, reject) => {
        let output = "";
        child.once("error", reject);
        child.stdout?.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes("\n")) resolve(output.split("\n")[0]);
        });
      });
      const session = JSON.parse(line) as { root: string; socketPath: string };
      child.kill("SIGTERM");
      const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
      expect(code).toBe(143);
      await expect(access(session.root, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(session.socketPath, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
    }
  );
});

async function run(executable: string, args: string[], environment: NodeJS.ProcessEnv) {
  const child = spawn(executable, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stderr: Buffer.concat(stderr).toString("utf8"), stdout: Buffer.concat(stdout).toString("utf8") };
}
