import { win32 } from "node:path";

export function buildPackagedCliInvocation(command, args, options) {
  if (options.platform !== "win32") return { args: [...args], command, env: {} };

  const comspec = options.comspec || win32.join(options.systemRoot || "C:\\Windows", "System32", "cmd.exe");
  if (!win32.isAbsolute(comspec)) throw new Error("Windows ComSpec path must be absolute");
  if (!win32.isAbsolute(command)) throw new Error("Windows packaged CLI path must be absolute");
  const values = [command, ...args];
  values.forEach(validateCmdEnvironmentValue);
  const env = Object.fromEntries(
    values.map((value, index) => [
      index === 0 ? "MASTHEAD_PACKAGED_CLI" : `MASTHEAD_PACKAGED_CLI_ARG_${index - 1}`,
      value
    ])
  );
  const commandLine = ["%MASTHEAD_PACKAGED_CLI%", ...args.map((_value, index) => `%MASTHEAD_PACKAGED_CLI_ARG_${index}%`)]
    .map((name) => `"${name}"`)
    .join(" ");
  return {
    args: ["/d", "/v:off", "/s", "/c", `call ${commandLine}`],
    command: comspec,
    env
  };
}

function validateCmdEnvironmentValue(value) {
  if (/[\0\r\n"]/u.test(value)) {
    throw new Error("Windows command arguments cannot contain quotes or control characters");
  }
}
