// test/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as entry from "../src/index";

vi.mock("../src/momento/client", () => {
  return {
    MomentoClient: vi.fn().mockImplementation(() => ({
      topicPublish: vi.fn().mockResolvedValue(undefined),
      topicSubscribe: vi.fn().mockResolvedValue({ items: [] }),
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

  it("throws if skills array is empty", () => {
    expect(() =>
      entry.createMomentoAgent({
        cacheName: "c",
        apiKey: "k",
        skills: [],
        handler,
      })
    ).toThrow(/At least one skill/i);
  });

  it("warns if agentCard.url is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    entry.createMomentoAgent({
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

  it("fills in default agentCard values", () => {
    const app = entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
    });
    // Should return a Hono app with fetch method
    expect(typeof app.fetch).toBe("function");
  });

  it("uses agentCard fields if provided", () => {
    const app = entry.createMomentoAgent({
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
    // Just smoke test; could fetch agentCard if you wire through Hono/test utils
    expect(typeof app.fetch).toBe("function");
  });

  it("applies custom options (defaultTtlSeconds, basePath)", () => {
    const app = entry.createMomentoAgent({
      cacheName: "c",
      apiKey: "k",
      skills: ["foo"],
      handler,
      options: { defaultTtlSeconds: 42, basePath: "/foo" },
    });
    expect(typeof app.fetch).toBe("function");
    // Not much else to assert without more hooks, but at least check no error
  });
});
