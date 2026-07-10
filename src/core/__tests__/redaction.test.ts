import { describe, expect, test } from "vitest";
import { hasSemanticRedactedText, redactCommandOutput, redactPath, redactText } from "../redaction";

describe("privacy redaction", () => {
  test("redacts common secret-bearing strings before persistence", () => {
    const input = [
      "Authorization: Bearer sk-live-1234567890abcdef",
      "DATABASE_URL=postgres://user:secret@db.example.com:5432/app",
      "Cookie: session=abc123.def456",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "https://user:password@example.com/private",
      "email tyler@example.com",
      "github_pat_11AAAAAAA0BBBBBBBB1CCCCCCCC2DDDDDDDD3EEEEEEEE4",
      "xoxb-123456789012-abcdefghijklmnop",
      "AKIAIOSFODNN7EXAMPLE",
      "0123456789abcdef0123456789abcdef"
    ].join("\n");

    const redacted = redactText(input);

    expect(redacted).not.toContain("sk-live-1234567890abcdef");
    expect(redacted).not.toContain("postgres://user:secret");
    expect(redacted).not.toContain("abc123.def456");
    expect(redacted).not.toContain("wJalrXUtnFEMI");
    expect(redacted).not.toContain("user:password@example.com");
    expect(redacted).not.toContain("tyler@example.com");
    expect(redacted).not.toContain("github_pat_");
    expect(redacted).not.toContain("xoxb-123456789012");
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).not.toContain("0123456789abcdef0123456789abcdef");
    expect(redacted).toContain("[SECRET:bearer_token]");
    expect(redacted).toContain("[SECRET:database_url]");
    expect(redacted).toContain("[SECRET:cookie]");
    expect(redacted).toContain("[SECRET:env_secret]");
    expect(redacted).toContain("https://[SECRET:credentials]@example.com/private");
    expect(redacted).toContain("[SECRET:email]");
    expect(redacted).toContain("[SECRET:slack_token]");
    expect(redacted).toContain("[SECRET:aws_access_key]");
    expect(redacted).toContain("[SECRET:hex_token]");
  });

  test("redacts private key blocks", () => {
    const redacted = redactText(
      [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ",
        "-----END OPENSSH PRIVATE KEY-----"
      ].join("\n")
    );

    expect(redacted).toBe("[SECRET:private_key]");
  });

  test("suppresses sensitive path contents while preserving path metadata", () => {
    expect(redactPath(".env.local")).toEqual({
      path: ".env.local",
      sensitivity: "sensitive_path_only"
    });
    expect(redactPath("src/lib/auth/session.ts")).toEqual({
      path: "src/lib/auth/session.ts",
      sensitivity: "metadata"
    });
  });

  test("bounds command output after redaction", () => {
    const input = `token=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n${"x".repeat(5000)}`;
    const output = redactCommandOutput(input, 160);

    expect(output.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(output.text.length).toBeLessThanOrEqual(160);
    expect(output.truncated).toBe(true);
  });

  test("distinguishes redaction-only placeholders from retained semantic text", () => {
    const wrapperOnly = [
      "[SECRET:private_key]",
      "[SECRET:api_key]\n[redacted]",
      "password: [SECRET:api_key]",
      "email [SECRET:email]",
      "Authorization: Bearer [SECRET:bearer_token]",
      "X-Api-Key: [SECRET:api_key]",
      "  X-Custom-Header: [SECRET:api_key]",
      "  X-Trace-Id: [SECRET:api_key]",
      '{"headers":{"authorization":"Bearer [SECRET:bearer_token]"},"password":"[SECRET:api_key]"}',
      '{"metadata":"[SECRET:api_key]"}',
      '{"X-Trace-Id":"[SECRET:api_key]"}',
      [
        "password: [SECRET:api_key]",
        "email [SECRET:email]",
        "Authorization: Bearer [SECRET:bearer_token]",
        "Cookie: [SECRET:cookie]"
      ].join("\n")
    ];

    wrapperOnly.forEach((value) => expect(hasSemanticRedactedText(value)).toBe(false));
    expect(hasSemanticRedactedText("Deployment failed: [SECRET:api_key]")).toBe(true);
    expect(hasSemanticRedactedText("Observed failure: Authorization: Bearer [SECRET:bearer_token]")).toBe(true);
    expect(hasSemanticRedactedText("password-rotation-failed: [SECRET:api_key]")).toBe(true);
    expect(hasSemanticRedactedText("deployment_password_failed=[SECRET:api_key]")).toBe(true);
    expect(hasSemanticRedactedText("api.request.failed: [SECRET:api_key]")).toBe(true);
    expect(hasSemanticRedactedText('{"deployment_failed":"[SECRET:api_key]"}')).toBe(true);
    expect(
      hasSemanticRedactedText('{"observed_failure":"Authorization: Bearer [SECRET:bearer_token]"}')
    ).toBe(true);
    expect(hasSemanticRedactedText("password rotation failed after [SECRET:api_key]")).toBe(true);
    expect(hasSemanticRedactedText("Use [SECRET:api_key] for the staging integration.")).toBe(true);
    expect(hasSemanticRedactedText("The canonical outcome shipped after verification.")).toBe(true);
  });
});
