import { describe, expect, test } from "vitest";
import { redactCommandOutput, redactPath, redactText } from "../redaction";

describe("privacy redaction", () => {
  test("redacts common secret-bearing strings before persistence", () => {
    const input = [
      "Authorization: Bearer sk-live-1234567890abcdef",
      "DATABASE_URL=postgres://user:secret@db.example.com:5432/app",
      "Cookie: session=abc123.def456",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "https://user:password@example.com/private"
    ].join("\n");

    const redacted = redactText(input);

    expect(redacted).not.toContain("sk-live-1234567890abcdef");
    expect(redacted).not.toContain("postgres://user:secret");
    expect(redacted).not.toContain("abc123.def456");
    expect(redacted).not.toContain("wJalrXUtnFEMI");
    expect(redacted).not.toContain("user:password@example.com");
    expect(redacted).toContain("[SECRET:bearer_token]");
    expect(redacted).toContain("[SECRET:database_url]");
    expect(redacted).toContain("[SECRET:cookie]");
    expect(redacted).toContain("[SECRET:env_secret]");
    expect(redacted).toContain("https://[SECRET:credentials]@example.com/private");
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
});
