export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliErrorCode =
  | "invalid_json"
  | "invalid_scope"
  | "invalid_state"
  | "missing_argument"
  | "unknown_command"
  | "unknown_schema";

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

export function errorResult(code: CliErrorCode, message: string, json: boolean): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: json ? `${JSON.stringify({ ok: false, error: { code, message } })}\n` : `${message}\n`
  };
}
