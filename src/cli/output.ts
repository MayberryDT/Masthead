export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliErrorCode = string;

export function textResult(stdout: string, exitCode = 0): CliResult {
  return {
    exitCode,
    stderr: "",
    stdout
  };
}

export function jsonResult(value: unknown, exitCode = 0): CliResult {
  return textResult(`${JSON.stringify(value)}\n`, exitCode);
}

export function errorResult(
  code: CliErrorCode,
  message: string,
  json: boolean,
  details: Record<string, unknown> = {}
): CliResult {
  const definedDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  return {
    exitCode: 1,
    stdout: "",
    stderr: json ? `${JSON.stringify({ ok: false, error: { code, message, ...definedDetails } })}\n` : `${message}\n`
  };
}
