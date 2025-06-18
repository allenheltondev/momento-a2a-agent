
# Momento A2A Agent

A production-ready TypeScript package for building stateless [A2A agents](https://google-a2a.github.io/A2A/latest/) on Cloudflare Workers, AWS Lambda, or anywhere JavaScript runs. This package enhances the capabilities of the A2A protocol using [Momento](https://gomomento.com/) for zero-infrastructure *global state, streaming, and agent discovery*.

[![NPM](https://img.shields.io/npm/v/momento-a2a-agent)](https://www.npmjs.com/package/momento-a2a-agent)

## In this package

This package provides:

* Full A2A task execution and state management with no database required
* Real-time streaming and observability with [Momento Topics](https://gomomento.com/platform/topics/)
* Easy agent discovery and registration with [Momento cache](https://gomomento.com/platform/cache)
* Drop-in support for Cloudflare Workers, Lambda, Azure Functions, and Google Cloud Run functions

## Why Momento for A2A?

A2A is an open standard designed to enable seamless communication and collaboration between AI agents. However, the provided SDKs offer only a stateful solution - sticky sessions, local caches, region-locked DBs, or single-instance event streams. This limits scale, reliability, and global reach.

### But with Momento

With Momento powering your A2A agent infrastructure, your agents become truly stateless and horizontally scalable.

Task state and events are stored in Momento rather than in your application or local memory. This means you can deploy as many agent instances as you like, anywhere in the world, and they'll always have instant access to the latest state.

Real-time streaming and observability are built in, so you can observe and react to every task, message, or event instantly by subscribing to Momento Topics. This applies to both your agents, your observability platform, and even your web pages!

Agents can also be registered for global discovery, removing the need for config files or hard-coded endpoints and enabling dynamic, distributed agent networks. Best of all, there's no DevOps required: with Momento, you avoid database migrations, cache clusters, and scaling bottlenecks, as all the infrastructure complexity is managed for you.

This approach unlocks true cloud-native A2A agents that are elastic, observable, and discoverable right out of the box.

## Prerequsisites

To use this to build an agent, you must create a [Momento API key](https://console.gomomento.com/api-keys) with **super user permissions**. You will also need to create a cache in your Momento account. That's it! The rest is handled for you via the package.

## Example: Minimal Cloudflare Worker

```ts
import { createMomentoAgent } from "momento-a2a-agent";

type Env = {
  MOMENTO_API_KEY: { get(): Promise<string> };
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		try {
			const apiKey = await env.MOMENTO_API_KEY.get();
			const app = await createMomentoAgent({
				cacheName: "mcp",
				apiKey,
				skills: [{ id: "echo", name: "Echo", description: "Repeats your message.", tags: ['echo'] }],
				handler: async (message) => {
					const part: any = message.parts?.[0];
					return `Echo: ${part.text ?? ""}`;
				},
				agentCard: { name: 'Echo agent', description: 'An agent that echoes input' },
				options: { registerAgent: true }
			});

			return app.fetch(request, env, ctx);
		} catch (err: any) {
			console.error(JSON.stringify(err, null, 2));
			return new Response(err.message, { status: 500 });
		}
	}
};

```


## Example: Advanced Worker with Claude and MCP server

```ts
import { createMomentoAgent } from "momento-a2a-agent";
import type { Message } from "momento-a2a-agent";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

type Env = {
  MOMENTO_API_KEY: { get(): Promise<string> };
  ANTHROPIC_API_KEY: { get(): Promise<string>};
};

let agent: ReturnType<typeof createMomentoAgent> | undefined;

async function createAgent(){
  const anthropicApiKey = await env.ANTHROPIC_API_KEY.get();
  const claude = new Anthropic({ apiKey: anthropicApiKey});

  const handler = async (message: Message): Promise<string> => {
    const response = await claude.beta.messages.create({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1000,
        messages: [{ role: "user", content: message.parts
            .filter((p: any) => p.kind === 'text' && !!p.text)
            .map((p: any) => p.text).join('\n') }],
        mcp_servers: [
          {
            type: "url",
            url: "https://<my mcp server url>",
            name: "<my tools>",
          },
        ],
        betas: ["mcp-client-2025-04-04"],
      });

      const assistantText =
        typeof response.content === "string"
          ? response.content
          : response.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n");
      return assistantText
  }

  const momentoApiKey = await env.MOMENTO_API_KEY.get();
  agent = await createMomentoAgent({
    cacheName: "ai",
    apiKey: momentoApiKey,
    skills: [{ name: "Custom MCP work", description: "Asks an LLM to do something related to an MCP server", examples: ["Do that thing with my stuff"]}],
    handler,
    agentCard: {
      name: "MCPBot",
      description: "Does work with your MCP server",
      url: "https://agent.mymcp.com"
    },
    options: {
      defaultTtlSeconds: 3600,
      registerAgent: true,
      enableCors: false
    }
  });
  return agent;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if(!agent){
      agent = await createAgent();
    }
    return agent.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;

```

### `createMomentoAgent` fields

| Parameter   | Type                                                       | Required | Description                                                                 | Default   |
| ----------- | ---------------------------------------------------------- | -------- | --------------------------------------------------------------------------- | --------- |
| `cacheName` | `string`                                                   | Yes      | Name of the Momento cache to use for state and events.                      |           |
| `apiKey`    | `string`                                                   | Yes      | Momento API key (can be stored in Cloudflare Secrets).                      |           |
| `skills`    | `AgentCard['skills']`                                      | Yes      | Array of skills this agent provides, for discoverability and documentation. |           |
| `handler`   | `(message: Message, ctx: { task?: Task }) => Promise<any>` | Yes      | Async function handling each incoming message.                              |           |
| `agentCard` | `Partial<AgentCard>`                                       | No       | Customize agent metadata (name, description, url, etc).                     | See below |
| `options`   | `CreateMomentoAgentOptions`                                | No       | Extra options for TTL, CORS, and agent registration.                        | See below |

### `agentCard` fields

| Field                | Type                    | Description                            | Default                                                                       |
| -------------------- | ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `name`               | `string`                | Agent display name.                    | `"Momento Agent"`                                                             |
| `description`        | `string`                | What the agent does.                   | `"A serverless agent powered by Momento"`                                     |
| `url`                | `string`                | Publicly reachable URL for your agent. | `"."`                                                                         |
| `provider`           | `{ organization, url }` | Organization info.                     | `{ organization: "unknown", url: "" }`                                        |
| `version`            | `string`                | Semantic version.                      | `"1.0.0"`                                                                     |
| `capabilities`       | `object`                | Streaming, pushNotifications, etc.     | `{ streaming: true, pushNotifications: false, stateTransitionHistory: true }` |
| `defaultInputModes`  | `string[]`              | Supported input formats.               | `["text"]`                                                                    |
| `defaultOutputModes` | `string[]`              | Supported output formats.              | `["text"]`                                                                    |

### `options` fields

| Field               | Type                                      | Description                                                | Default |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------- |
| `defaultTtlSeconds` | `number`                                  | Default task TTL (expiration) in seconds.                  | `3600`  |
| `registerAgent`     | `boolean`                                 | If `true`, registers agent in Momento for global discovery | `false` |
| `enableCors`        | `boolean \| { origin, headers, methods }` | Enable/disable/configure CORS headers.                     | `false` |

## Agent registration and discovery

When `registerAgent: true` is set in the provided options, your agent will:

* Register its `AgentCard` and summary in Momento under a public list (`agent:list`)
* Allow clients to discover agents and fetch full metadata
* TTL is auto-refreshed (24h) so stale agents disappear

To query all agents, use Momento Cache to get the `agents:list` cache key or `agents:<agent name>` cache key for the full agent list or metadata respectively.

**COMING SOON** - A2A client support with auto discover of listed agents so you don't have to check the cache yourself

## Example Output

Here's a sample JSON-RPC response from an agent:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "task-1",
    "status": {
      "state": "completed",
      "message": {
        "kind": "message",
        "role": "agent",
        "messageId": "msg-123",
        "parts": [{ "kind": "text", "text": "Echo: hello world" }],
        "contextId": "ctx-1"
      },
      "timestamp": "2024-06-16T13:24:55.872Z"
    },
    "history": [
      {
        "kind": "message",
        "role": "user",
        "messageId": "msg-122",
        "parts": [{ "kind": "text", "text": "hello world" }],
        "contextId": "ctx-1"
      }
    ],
    "artifacts": [],
    "metadata": {}
  },
  "id": 1
}
```

You can stream all events and state transitions live, or load the latest task state from anywhere.

## Links

* [A2A protocol spec](https://google-a2a.github.io/A2A/latest/)
* [Momento Topics](https://gomomento.com/products/topics/)
* [Momento Cache](https://gomomento.com/products/cache/)
* [A2A reference and examples](https://github.com/google-a2a/a2a-js)

## License

See [LICENSE](./LICENSE).

*Want more examples or a deep dive? Open an issue or PR!*
