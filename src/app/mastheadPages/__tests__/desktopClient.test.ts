import { afterEach, describe, expect, test, vi } from "vitest";
import { createMastheadPagesDesktopClient, isMastheadPagesDesktopClientAvailable } from "../desktopClient";

describe("mastheadPages desktopClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("is unavailable without typed preload methods", async () => {
    vi.stubGlobal("window", {
      mastheadDesktop: {
        invoke: async () => ({ ok: true })
      }
    });
    expect(isMastheadPagesDesktopClientAvailable()).toBe(false);
    const client = createMastheadPagesDesktopClient();
    await expect(client.getConnection()).rejects.toThrow(/bridge_unavailable/);
  });

  test("routes through narrow typed preload methods and never generic shell IPC", async () => {
    const calls: string[] = [];
    const connection = {
      status: "connected" as const,
      account: {
        protocolVersion: "masthead-pages-account-v1" as const,
        accountId: "11111111-1111-4111-8111-111111111111",
        publisherAccess: "publisher" as const,
        defaultLogbookVisibility: "discoverable" as const
      }
    };
    vi.stubGlobal("window", {
      mastheadDesktop: {
        invoke: async (command: string) => {
          calls.push(`invoke:${command}`);
          return { ok: true };
        },
        getMastheadPagesConnection: async () => {
          calls.push("getMastheadPagesConnection");
          return connection;
        },
        connectMastheadPages: async () => {
          calls.push("connectMastheadPages");
          return connection;
        },
        disconnectMastheadPages: async () => {
          calls.push("disconnectMastheadPages");
        },
        listMastheadPagesLogbooks: async () => {
          calls.push("listMastheadPagesLogbooks");
          return [];
        },
        createMastheadPagesLogbook: async () => {
          calls.push("createMastheadPagesLogbook");
          return {
            id: "11111111-1111-4111-8111-111111111112",
            ownerAccountId: "11111111-1111-4111-8111-111111111111",
            title: "Notes",
            slug: "notes",
            description: "",
            visibility: "discoverable",
            defaultLicense: "all-rights-reserved"
          };
        },
        publishStagedToMastheadPages: async (args: { refs: Array<{ artifactId: string; requestDigest: string }> }) => {
          calls.push(`publish:${args.refs[0]?.artifactId}`);
          return { protocolVersion: "masthead-pages-publish-batch-result-v1", results: [] };
        },
        removeStagedFromMastheadPages: async (args: { ref: { artifactId: string; requestDigest: string } }) => {
          calls.push(`remove:${args.ref.artifactId}`);
          return {
            protocolVersion: "masthead-pages-remove-result-v1",
            pageId: "page_1",
            idempotencyKey: "idem",
            status: "removed",
            retryable: false
          };
        }
      }
    });

    expect(isMastheadPagesDesktopClientAvailable()).toBe(true);
    const client = createMastheadPagesDesktopClient();
    await expect(client.getConnection()).resolves.toEqual(connection);
    await expect(client.connect()).resolves.toEqual(connection);
    await client.disconnect();
    await expect(client.listPublicLogbooks()).resolves.toEqual([]);
    await client.createPublicLogbook({
      protocolVersion: "masthead-pages-logbook-v1",
      title: "Notes",
      slug: "notes",
      description: "",
      defaultLicense: "all-rights-reserved"
    });
    await client.publishStaged([{ artifactId: "a1", requestDigest: "sha256-abc" }]);
    await client.withdrawStaged({ artifactId: "a1", requestDigest: "sha256-abc" });

    expect(calls).toEqual([
      "getMastheadPagesConnection",
      "connectMastheadPages",
      "disconnectMastheadPages",
      "listMastheadPagesLogbooks",
      "createMastheadPagesLogbook",
      "publish:a1",
      "remove:a1"
    ]);
    expect(calls.some((call) => call.includes("shell"))).toBe(false);
  });
});
