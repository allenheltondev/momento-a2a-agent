import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import { JSONRPCErrorResponse, JSONRPCSuccessResponse, A2ARequest } from "./types";
import { A2AError } from "./server/error.js";
import { MomentoAgentRequestHandler } from "./agent/request_handler.js";
import { JsonRpcTransportHandler } from "./transport/jsonrpc.js";
import { A2AResponse } from "./a2a_response";

export interface A2AServerOptions {
  basePath?: string;
  enableCors?: boolean | { origin?: string; headers?: string; methods?: string; };
}

export class A2AServer {
  private requestHandler: MomentoAgentRequestHandler;
  private transportHandler: JsonRpcTransportHandler;
  private basePath: string;
  private cors: A2AServerOptions["enableCors"];

  /**
   * @param requestHandler User's handler (usually built with just cache name & api key)
   * @param options        Optional config: CORS, custom basePath
   */
  constructor(requestHandler: MomentoAgentRequestHandler, options?: A2AServerOptions) {
    this.requestHandler = requestHandler;
    this.transportHandler = new JsonRpcTransportHandler(requestHandler);
    this.basePath = (options?.basePath ?? "/").replace(/\/?$/, "/");
    this.cors = options?.enableCors ?? false;
  }

  app(): Hono {
    const app = new Hono();

    if (this.cors) {
      const corsConfig = typeof this.cors === "object" ? this.cors : {};
      const {
        origin = "*",
        headers = "*",
        methods = "GET,POST,OPTIONS",
      } = corsConfig;

      app.use("*", async (c, next) => {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Headers", headers);
        c.header("Access-Control-Allow-Methods", methods);

        if (c.req.method === "OPTIONS") {
          return c.body(null, 204);
        }

        await next();
      });
    }

    // ---- Well-known endpoint for agent card ----
    app.options(this.basePath + ".well-known/agent.json", (c) => c.body(null, 204));
    app.get(this.basePath + ".well-known/agent.json", async (c: Context) => {
      const agentCard = await this.requestHandler.getAgentCard();
      return c.json(agentCard);
    });

    // ---- JSON-RPC endpoint ----
    app.post(this.basePath === '/' ? '/' : this.basePath.replace(/\/$/, ''), async (c: Context) => {
      let request: A2ARequest | undefined;

      try {
        request = await c.req.json();

        if (
          !request ||
          typeof request !== "object" ||
          request.jsonrpc !== "2.0" ||
          typeof request.method !== "string"
        ) {
          throw A2AError.invalidRequest("Malformed JSON-RPC request.");
        }

        const rpcResponseOrStream = await this.transportHandler.handle(request);

        if (typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] === "function") {
          const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");

          // ---- Heartbeat/ping for proxies ----
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          const PING_INTERVAL = 15000; // 15s

          return streamSSE(c, async (streamingResponse) => {
            heartbeat = setInterval(() => {
              streamingResponse.write(`event: ping\ndata: {}\n\n`);
            }, PING_INTERVAL);

            try {
              for await (const event of stream) {
                const sseId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                streamingResponse.write(`id: ${sseId}\n`);
                streamingResponse.write(`data: ${JSON.stringify(event)}\n\n`);
              }
            } catch (streamError: any) {
              console.error(`Error during SSE streaming (request ${request?.id}):`, streamError);
              const a2aError =
                streamError instanceof A2AError
                  ? streamError
                  : A2AError.internalError(streamError.message || "Streaming error.");
              const errorResponse: JSONRPCErrorResponse = {
                jsonrpc: "2.0",
                id: request?.id ?? null,
                error: a2aError.toJSONRPCError(),
              };
              const sseId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
              streamingResponse.write(`id: ${sseId}\n`);
              streamingResponse.write(`event: error\n`);
              streamingResponse.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
            } finally {
              if (heartbeat) clearInterval(heartbeat);
            }
          });
        }

        // ---- Non-streaming (single response) ----
        return c.json(rpcResponseOrStream as A2AResponse, 200);

      } catch (error: any) {
        console.error("Unhandled error in POST handler:", error);

        const a2aError =
          error instanceof A2AError
            ? error
            : A2AError.internalError(error?.message || "General processing error.");

        const errorResponse: JSONRPCErrorResponse = {
          jsonrpc: "2.0",
          id: request?.id ?? null,
          error: a2aError.toJSONRPCError(),
        };

        return c.json(errorResponse, 500);
      }
    });

    return app;
  }
}
