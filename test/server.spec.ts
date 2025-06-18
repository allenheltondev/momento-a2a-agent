// tests/server.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { A2AServer } from "../src/server";
import { ReadableStream } from "node:stream/web";

function makeHandler(overrides = {}) {
  // Add whatever you want to mock/override in tests
  return {
    getAgentCard: async () => ({ name: "Test Agent", description: "desc", capabilities: { streaming: true} }),
    sendMessage: async () => ({ id: "123", status: { state: "completed" } }),
    sendMessageStream: async function* () {
      yield { jsonrpc: "2.0", result: { id: "stream-task", status: { state: "completed" } }, id: 1 };
    },
    ...overrides,
  };
}

describe("A2AServer", () => {
  let server: A2AServer;
  let app: ReturnType<A2AServer["app"]>;

  beforeEach(() => {
    // Use a new instance per test for isolation
    server = new A2AServer(makeHandler());
    app = server.app();
  });

  it("responds with agent card", async () => {
    const req = new Request("http://localhost/.well-known/agent.json");
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("name", "Test Agent");
  });

  it("responds with 204 to OPTIONS for agent card", async () => {
    const req = new Request("http://localhost/.well-known/agent.json", { method: "OPTIONS" });
    const res = await app.fetch(req);
    expect(res.status).toBe(204);
  });

  it("responds with 500 for malformed JSON-RPC request", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("responds with 200 for valid JSON-RPC request", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "message/send",
        params: { message: { messageId: "1", parts: [], contextId: "ctx" } },
        id: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("result");
  });

  it("sends correct CORS headers if enabled", async () => {
    server = new A2AServer(makeHandler(), {
      enableCors: { origin: "https://foo.com", headers: "X-Test-Header", methods: "GET,POST" },
    });
    app = server.app();

    const req = new Request("http://localhost/", { method: "OPTIONS" });
    const res = await app.fetch(req);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://foo.com");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("X-Test-Header");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    expect(res.status).toBe(204);
  });

  it("returns 404 for unknown route", async () => {
    const req = new Request("http://localhost/unknown-route");
    const res = await app.fetch(req);
    expect(res.status).toBe(404);
  });

  it("handles errors thrown by the handler", async () => {
    server = new A2AServer(makeHandler({
      getAgentCard: vi.fn().mockRejectedValue(new Error("fail!")),
    }));
    app = server.app();

    const req = new Request("http://localhost/.well-known/agent.json");
    const res = await app.fetch(req);
    // Hono returns 500 for thrown errors
    expect(res.status).toBe(500);
  });

  it("streams events (SSE) from JSON-RPC streaming endpoint", async () => {
    server = new A2AServer(makeHandler({
      // This handler yields two SSE events and ends
      sendMessageStream: async function* () {
        yield { jsonrpc: "2.0", result: { foo: 1 }, id: 1 };
        yield { jsonrpc: "2.0", result: { bar: 2 }, id: 1 };
      },
    }));
    app = server.app();

    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "message/stream",
        params: { message: { messageId: "1", parts: [], contextId: "ctx" } },
        id: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await app.fetch(req);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    // Read the SSE body as text and check the events
    const reader = res.body!.getReader();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += Buffer.from(value).toString("utf-8");
    }
    // Check that both results are streamed
    expect(result).toContain(`"foo":1`);
    expect(result).toContain(`"bar":2`);
  });

  it("returns error if agent does not support streaming but client requests stream", async () => {
  server = new A2AServer(
    makeHandler({
      getAgentCard: async () => ({
        name: "Test Agent",
        description: "desc",
        capabilities: { streaming: false },
      }),
      sendMessageStream: async function* () {
        // Shouldn't be called!
        throw new Error("Should not reach here");
      },
    })
  );
  app = server.app();

  const req = new Request("http://localhost/", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "message/stream",
      params: { message: { messageId: "1", parts: [], contextId: "ctx" } },
      id: 1,
    }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await app.fetch(req);
  const json = await res.json();
  console.log(json);
  expect(res.status).toBe(200);
  expect(json?.error?.message || json?.error).toMatch(/streaming/i);
  expect(json?.error?.code).toBe(-32004);
});

});
