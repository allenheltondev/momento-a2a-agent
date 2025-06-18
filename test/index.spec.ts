// test/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as entry from "../src/index";

vi.mock("../src/momento/client", () => {
  return {
    MomentoClient: vi.fn().mockImplementation(() => ({
      topicPublish: vi.fn().mockResolvedValue(undefined),
      topicSubscribe: vi.fn().mockResolvedValue({ items: [] }),
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      multiSet: vi.fn().mockResolvedValue(undefined),
      isValidConnection: vi.fn().mockResolvedValue(true)
    })),
  };
});

describe("index exports", () => {
  it("exports expected API surface", () => {
    expect(entry).toHaveProperty("createMomentoAgent");
  });
});

describe("createMomentoAgent", () => {
  let handler: any;
  beforeEach(() => {
    handler = vi.fn().mockResolvedValue("ok");
  });

  it("throws if skills array is empty", async () => {
    await expect(
      entry.createMomentoAgent({
        cacheName: "c",
        apiKey: "k",
        skills: [],
        handler,
      })
    ).rejects.toThrow(/At least one skill/i);
  });

  it("warns if agentCard.url is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/configure your agent url/i)
    );
    warn.mockRestore();
  });

  it("fills in default agentCard values", async () => {
    const app = await entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
    });
    expect(typeof app.fetch).toBe("function");
  });

  it("uses agentCard fields if provided", async () => {
    const app = await entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
      agentCard: {
        name: "MyAgent",
        description: "Desc",
        url: "http://x",
        provider: { organization: "yo", url: "http://yo" },
        version: "9.8.7",
        capabilities: {
          streaming: false,
          pushNotifications: true,
          stateTransitionHistory: false,
        },
        defaultInputModes: ["text", "voice"],
        defaultOutputModes: ["text", "audio"],
      },
    });
    expect(typeof app.fetch).toBe("function");
  });

  it("applies custom options (defaultTtlSeconds, basePath)", async () => {
    const app = await entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
      options: { defaultTtlSeconds: 42, basePath: "/foo" },
    });
    expect(typeof app.fetch).toBe("function");
  });
});
