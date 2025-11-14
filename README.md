# Momento A2A Agent

A production-ready TypeScript package for building stateless [A2A agents](https://google-a2a.github.io/A2A/latest/) on Cloudflare Workers, AWS Lambda, or anywhere JavaScript runs. This package enhances the capabilities of the A2A protocol using [Momento](https://gomomento.com/) for zero-infrastructure *global state, streaming, and agent discovery*.

[![NPM](https://img.shields.io/npm/v/momento-a2a-agent)](https://www.npmjs.com/package/momento-a2a-agent) ![Unit Tests](https://github.com/allenheltondev/momento-a2a-agent/actions/workflows/ci.yml/badge.svg)

## Installation

```bash
npm install momento-a2a-agent
```

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

## A2A Servers

The brains of the operation, A2A servers are what handles the processing of tasks. Below is how to build a server and what properties you need to do it.

### Example: Minimal Cloudflare Worker

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

### Example: Advanced Worker with Claude and MCP server

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
    skills: [{
      id: 'mcp'
      name: "Custom MCP work",
      description: "Asks an LLM to do something related to an MCP server",
      examples: ["Do that thing with my stuff"],
      tags: ['mcp']
    }],
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

#### `createMomentoAgent` fields

| Parameter   | Type                                                       | Required | Description                                                                 | Default   |
| ----------- | ---------------------------------------------------------- | -------- | --------------------------------------------------------------------------- | --------- |
| `cacheName` | `string`                                                                                    | Yes      | Name of the Momento cache to use for state and events.                      |           |
| `apiKey`    | `string`                                                                                    | Yes      | Momento API key (can be stored in Cloudflare Secrets).                      |           |
| `skills`    | `AgentCard['skills']`                                                                       | Yes      | Array of skills this agent provides, for discoverability and documentation. |           |
| `handler`   | `(message: Message, ctx: { task: Task; publishUpdate: PublishUpdateFn }) => Promise<any>` | Yes      | Async function handling each incoming message.                              |           |
| `agentCard` | `Partial<AgentCard>`                                                                        | No       | Customize agent metadata (name, description, url, etc).                     | See below |
| `options`   | `CreateMomentoAgentOptions`                                                                 | No       | Extra options for TTL, CORS, and agent registration.                        | See below |
| `type`      | `AgentType`                                                                                 | No       | Agent type: `"worker"` or `"supervisor"`. Affects status update behavior.   | `"worker"` |

#### `agentCard` fields

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

#### `options` fields

| Field               | Type                                      | Description                                                | Default |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------- |
| `defaultTtlSeconds` | `number`                                  | Default task TTL (expiration) in seconds.                  | `3600`  |
| `registerAgent`     | `boolean`                                 | If `true`, registers agent in Momento for global discovery | `false` |
| `enableCors`        | `boolean \| { origin, headers, methods }` | Enable/disable/configure CORS headers.                     | `false` |

### Agent Types

Agents can be created as either **worker** agents or **supervisor** agents by specifying the `type` parameter:

#### Worker Agents (default)

Worker agents execute specific tasks and are the default agent type. When using the unified creation functions (`createBedrockAgent` or `createOpenAIAgent`), worker agents use orchestrators with custom tools, providing automatic status updates for tool invocations.

For basic agents without orchestration, use `createMomentoAgent` directly:

```ts
const basicAgent = await createMomentoAgent({
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  type: 'worker', // Optional, this is the default
  skills: [{
    id: 'weather',
    name: 'Get Weather',
    description: 'Gets weather information',
    tags: ['weather']
  }],
  handler: async (message, { publishUpdate }) => {
    await publishUpdate('Fetching weather data...');
    return 'Sunny, 72°F';
  }
});
```

For worker agents with orchestration and automatic tool status updates, use the unified creation functions (see examples below).

#### Supervisor Agents

Supervisor agents coordinate multiple worker agents using orchestration. When you create a supervisor agent, tool invocation status updates are automatically published, providing visibility into orchestration progress.

For supervisor agents, it's recommended to use the unified creation functions `createBedrockAgent` or `createOpenAIAgent` instead of `createMomentoAgent` directly. See the [Unified Agent Creation](#unified-agent-creation) section below.

#### AgentType

The `AgentType` is exported from the package and can be used for type safety:

```ts
import { AgentType } from 'momento-a2a-agent';

const agentType: AgentType = 'supervisor';
```

### Publishing status updates

The handler receives a `publishUpdate` function in its context that allows you to send real-time status updates during task execution. This is useful for long-running tasks where you want to provide progress updates to clients.

```ts
handler: async (message, { task, publishUpdate }) => {
  // Publish a status update
  await publishUpdate('Processing your request...');

  // Do some work
  const result = await doSomeWork();

  // Publish another update
  await publishUpdate('Almost done, finalizing results...');

  // Return final result
  return `Completed: ${result}`;
}
```

The `publishUpdate` function accepts a single string parameter containing the status message text. It automatically wraps the message in the proper A2A format and publishes it as a "working" state update.

#### Status Updates for Supervisor Agents

When orchestrators invoke tools, they automatically publish status updates in the following format:

- **Before tool invocation**: `"Invoking tool: {toolName}"`
- **After successful completion**: `"Tool {toolName} completed successfully"`
- **After failure**: `"Tool {toolName} failed: {errorMessage}"`

These updates are published through the same event bus as worker agent updates and include the agent type in their metadata, allowing subscribers to distinguish between worker and supervisor events.

### Agent registration and discovery

When `registerAgent: true` is set in the provided options, your agent will:

* Register its `AgentCard` and summary in Momento under a public list (`agent:list`)
* Allow clients to discover agents and fetch full metadata
* TTL is auto-refreshed (24h) so stale agents disappear

To query all agents, use Momento Cache to get the `agents:list` cache key or `agents:<agent name>` cache key for the full agent list or metadata respectively.

### Example output

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

### Status Update Events

All status updates published by agents include metadata that identifies the agent type. This allows subscribers to distinguish between worker and supervisor events:

```json
{
  "kind": "status-update",
  "taskId": "task-123",
  "contextId": "ctx-1",
  "status": {
    "state": "working",
    "message": {
      "kind": "message",
      "role": "agent",
      "messageId": "msg-456",
      "parts": [{ "kind": "text", "text": "Invoking tool: weatherAgent" }],
      "contextId": "ctx-1",
      "taskId": "task-123"
    },
    "timestamp": "2024-06-16T13:24:55.872Z"
  },
  "final": false,
  "metadata": {
    "agentName": "Task Coordinator",
    "agentId": "task_coordinator",
    "agentType": "supervisor"
  }
}
```

The `metadata.agentType` field will be either `"worker"` or `"supervisor"`, allowing you to filter or route events based on agent type.

## A2A Client

A2A clients are simple in themselves, there's no magic involved. The client is initialized with an A2A server url, and it has the ability to send and parse messages to it. The [a2a-js](https://www.npmjs.com/package/@a2a-js/sdk) library does a solid job handling simple client management.

However, if you want to take advantage of the registry we created with the A2A Server in this package, it's best to use the **orchestrators** provided.

### Unified Agent Creation

For a streamlined experience, use `createBedrockAgent` or `createOpenAIAgent` to create both worker and supervisor agents with a consistent API. Both agent types use orchestrators internally:

- **Worker agents**: Use orchestrators with custom tools you provide
- **Supervisor agents**: Use orchestrators with auto-discovered agents as tools

Both types automatically publish status updates when tools are invoked, providing visibility into agent operations.

#### `createBedrockAgent`

Create worker or supervisor agents using Amazon Bedrock models.

**Worker Agent Example:**

Worker agents use orchestrators with custom tools. The orchestrator automatically publishes status updates when tools are invoked.

```ts
import { createBedrockAgent } from 'momento-a2a-agent';
import * as z from 'zod/v4';

const workerAgent = await createBedrockAgent({
  type: 'worker',
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  skills: [{
    id: 'weather',
    name: 'Get Weather',
    description: 'Gets weather information',
    tags: ['weather']
  }],
  tools: [{
    name: 'getWeather',
    description: 'Gets current weather for a location',
    schema: z.object({
      location: z.string().describe('City name')
    }),
    handler: async (input) => {
      // Custom weather logic
      return { temp: 72, condition: 'Sunny' };
    }
  }],
  agentCard: {
    name: 'Weather Agent',
    description: 'Provides weather information',
    url: 'https://weather.example.com'
  },
  bedrock: {
    modelId: 'amazon.nova-micro-v1:0'
  }
});
```

The orchestrator will automatically publish status updates like "Invoking tool: getWeather" and "Tool getWeather completed successfully".

**Supervisor Agent Example:**

```ts
import { createBedrockAgent } from 'momento-a2a-agent';

const supervisorAgent = await createBedrockAgent({
  type: 'supervisor',
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  agentCard: {
    name: 'Task Coordinator',
    description: 'Coordinates multiple agents to complete complex tasks',
    url: 'https://supervisor.example.com'
  },
  bedrock: {
    modelId: 'amazon.nova-pro-v1:0',
    region: 'us-east-1'
  },
  config: {
    maxTokens: 4000,
    debug: true,
    // Optional: add custom tools alongside auto-discovered agents
    tools: [{
      name: 'getCurrentTime',
      description: 'Gets the current time',
      schema: z.object({}),
      handler: async () => new Date().toISOString()
    }]
  },
  options: {
    registerAgent: true
  }
});
```

For supervisor agents:
- No `skills` are required - a default orchestration skill is provided
- The orchestrator automatically discovers and coordinates registered agents
- Optional custom tools can be added via `config.tools`
- Tool invocation status updates are published automatically for both custom tools and agent invocations

#### `createOpenAIAgent`

Create worker or supervisor agents using OpenAI models.

**Worker Agent Example:**

Worker agents use orchestrators with custom tools. The orchestrator automatically publishes status updates when tools are invoked.

```ts
import { createOpenAIAgent } from 'momento-a2a-agent';
import * as z from 'zod/v4';

const workerAgent = await createOpenAIAgent({
  type: 'worker',
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  skills: [{
    id: 'calendar',
    name: 'Calendar Management',
    description: 'Manages calendar events',
    tags: ['calendar']
  }],
  tools: [{
    name: 'getCalendar',
    description: 'Gets calendar events for today',
    schema: z.object({}),
    handler: async () => {
      // Custom calendar logic
      return { events: ['Meeting at 10am', 'Lunch at 12pm', 'Review at 3pm'] };
    }
  }],
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  }
});
```

The orchestrator will automatically publish status updates like "Invoking tool: getCalendar" and "Tool getCalendar completed successfully".

**Supervisor Agent Example:**

```ts
import { createOpenAIAgent } from 'momento-a2a-agent';
import * as z from 'zod/v4';

const supervisorAgent = await createOpenAIAgent({
  type: 'supervisor',
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  agentCard: {
    name: 'AI Coordinator',
    description: 'Orchestrates multiple AI agents',
    url: 'https://coordinator.example.com'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  },
  config: {
    maxTokens: 4000,
    debug: false,
    // Optional: add custom tools alongside auto-discovered agents
    tools: [{
      name: 'getCurrentTime',
      description: 'Gets the current time',
      schema: z.object({}),
      handler: async () => new Date().toISOString()
    }]
  }
});
```

### Orchestrators

Beyond simple communication with an A2A server, the orchestrators provided in this package will intelligently plan multi-step processes and communicate with all your agents automatically ️🔥 This offers a simple way to build state-of-the-art AI agents with minimal effort.

#### OpenAIOrchestrator

The `OpenAIOrchestrator` is a built-in utility for building routing agents that can coordinate calls to other A2A agents based on a user message. It uses OpenAI models and can stream responses in real time, making it ideal for multi-agent workflows that require planning, delegation, or summarization.

##### Basic usage

```ts
import { OpenAIOrchestrator } from 'momento-a2a-agent';

const orchestrator = new OpenAIOrchestrator({
  momento: {
    apiKey: 'YOUR_MOMENTO_API_KEY',
    cacheName: 'YOUR_CACHE'
  },
  openai: {
    apiKey: 'YOUR_OPENAI_API_KEY',
    model: 'gpt-4o'
  }
});

orchestrator.registerAgents([
  'https://weather.agent',
  'https://hotel.agent'
]);

const response = await orchestrator.sendMessage({ message: 'Book me a room in Austin this weekend and check the weather.' });
console.log(response);
```

##### Advanced configuration

```ts
const orchestrator = new OpenAIOrchestrator({
  momento: {
    apiKey: 'YOUR_MOMENTO_API_KEY',
    cacheName: 'YOUR_CACHE'
  },
  openai: {
    apiKey: 'YOUR_OPENAI_API_KEY',
    model: 'gpt-4o'
  },
  config: {
    maxTokens: 4000,
    agentLoadingConcurrency: 5,
    debug: true
  }
});
```

##### Streaming usage

You can stream responses using either a callback or an async iterator. Chunks are returned with a type field indicating whether the output is a partial chunk or the final summary.

```ts
for await (const chunk of orchestrator.sendMessageStream({ message: 'What animals on the farm are due for shots?' })) {
  if (chunk.type === 'chunk') process.stdout.write(chunk.text);
  if (chunk.type === 'final') console.log('\n\nFinal summary:', chunk.text);
}
```

Alternatively, use a callback-based approach:

```ts
await orchestrator.sendMessageStreamWithCallback({ message: 'What is on the schedule today?' }, (chunk) => {
  if (chunk.type === 'chunk') process.stdout.write(chunk.text);
  if (chunk.type === 'final') console.log('\nDone:', chunk.text);
});
```

##### `OpenAiOrchestratorParams`

| Property                  | Type                     | Required | Description                                                                 | Default    |
|---------------------------|--------------------------|----------|-----------------------------------------------------------------------------|------------|
| `momento.apiKey`          | `string`                 | ✅       | A Momento API key with access to the target cache                          |            |
| `momento.cacheName`       | `string`                 | ✅       | Name of the Momento cache to use for agent discovery and metadata storage  |            |
| `openai.apiKey`           | `string`                 | ✅       | OpenAI API key used for agent execution                                    |            |
| `openai.model`            | `string`                 | ❌       | Model name                                                                 | `'o4-mini'`|
| `config.maxTokens`        | `number`                 | ❌       | Maximum tokens for OpenAI responses                                        | `4000`     |
| `config.agentLoadingConcurrency` | `number`          | ❌       | Max number of concurrent agent card loads                                  | `3`        |
| `config.debug`           | `boolean`                 | ❌       | Enable detailed logging for debugging                                      | `false`    |
| `config.tokenWarningThreshold` | `number`            | ❌       | Logs a warning when the task has crossed a specific estimated token usage  | `3200`     |
| `config.preserveThinkingTags` | `boolean`            | ❌       | Indicate whether to include `<thinking>` tags from the llm in the response | `false`    |
| `config.tools`                | `Array<{ name, description, schema, handler }>` | ❌ | Additional custom tools exposed to the LLM (Zod schema + handler) | `[]`       |

#### AmazonBedrockOrchestrator

The `AmazonBedrockOrchestrator` provides the same orchestration capabilities using Amazon Bedrock models instead of OpenAI. It's ideal for users who prefer AWS services or need to stay within the AWS ecosystem. *This orchestrator is optimized for usage in AWS Lambda*. It will use the credentials and region provided in the runtime.

##### Basic usage

> To use the basic `sendMessage` command in AWS, your executing compute (Lambda, ECS, AppRunner, etc...) must grant the **bedrock:InvokeModel** IAM permission on the requested model. If you use the default values, it must grant the permission on the `arn:aws:bedrock:<AWS Region>::foundation-model/amazon.nova-lite-v1:0` resource.

```ts
import { AmazonBedrockOrchestrator } from 'momento-a2a-agent';

const orchestrator = new AmazonBedrockOrchestrator({
  momento: {
    apiKey: 'YOUR_MOMENTO_API_KEY',
    cacheName: 'YOUR_CACHE'
  },
  bedrock: {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
  }
});

orchestrator.registerAgents([
  'https://weather.agent',
  'https://calendar.agent'
]);

const response = await orchestrator.sendMessage({ message: 'Check my calendar and get the weather for tomorrow.' });
console.log(response);
```

##### Advanced configuration

```ts
const orchestrator = new AmazonBedrockOrchestrator({
  momento: {
    apiKey: 'YOUR_MOMENTO_API_KEY',
    cacheName: 'YOUR_CACHE'
  },
  bedrock: {
    region: 'us-west-2',
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    accessKeyId: 'YOUR_ACCESS_KEY',
    secretAccessKey: 'YOUR_SECRET_KEY',
    profile: 'default'
  },
  config: {
    maxTokens: 4000,
    tokenWarningThreshold: 3500,
    agentLoadingConcurrency: 5,
    debug: true,
    systemPrompt: 'Follow safety rules and summarize results clearly.',
    preserveThinkingTags: false
  }
});
```

##### Complete usage (all params, custom tools)

```ts
import { AmazonBedrockOrchestrator } from 'momento-a2a-agent';
import * as z from 'zod/v4';

const getTime = {
  name: 'getTime',
  description: 'Return the current time. Optionally specify a time zone.',
  schema: z.object({ tz: z.string().optional() }),
  handler: async ({ tz }: { tz?: string }) => {
    return new Date().toLocaleString('en-US', tz ? { timeZone: tz } : undefined);
  }
};

const orchestrator = new AmazonBedrockOrchestrator({
  momento: {
    apiKey: process.env.MOMENTO_API_KEY!,
    cacheName: 'ai'
  },
  bedrock: {
    // If omitted, region/profile/credentials are taken from the AWS runtime
    region: 'us-west-2',
    modelId: 'amazon.nova-lite-v1:0',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    profile: 'default'
  },
  tools: [getTime],
  config: {
    agentLoadingConcurrency: 3,
    systemPrompt: 'Prefer internal tools when possible. Keep answers concise.',
    maxTokens: 4000,
    tokenWarningThreshold: 3200,
    debug: false,
    preserveThinkingTags: false
  }
});

orchestrator.registerAgents([
  'https://weather.agent',
  'https://calendar.agent'
]);

const result = await orchestrator.sendMessage({
  message: 'What is on my calendar tomorrow and will it rain?',
  contextId: 'user-123'
});
console.log(result);
```

##### Streaming usage

The Bedrock orchestrator supports the following streaming patterns: `sendMessageStream` and `sendMessageStreamWithCallback`

> To use the `sendMessageStream` or `sendMessageStreamWithCallback` commands in AWS, your executing compute (Lambda, ECS, AppRunner, etc...) must grant the **bedrock:InvokeModelWithResponseStream** IAM permission on the requested model. If you use the default values, it must grant the permission on the `arn:aws:bedrock:<AWS Region>::foundation-model/amazon.nova-lite-v1:0` resource.

**`sendMessageStream`**
```ts
for await (const chunk of orchestrator.sendMessageStream({ message: 'Plan my day' })) {
  if (chunk.type === 'chunk') process.stdout.write(chunk.text);
  if (chunk.type === 'final') console.log('\n\nFinal summary:', chunk.text);
}
```

**`sendMessageStreamWithCallback`**
```ts
await orchestrator.sendMessageStreamWithCallback(
  {
    message: "What are the names of my garen beds?",
    contextId: 'allen'
  },
  (chunk) => console.log(chunk));
```

##### `AmazonBedrockOrchestratorParams`

| Property                  | Type                     | Required | Description                                                                 | Default                                      |
|---------------------------|--------------------------|----------|-----------------------------------------------------------------------------|----------------------------------------------|
| `momento.apiKey`          | `string`                 | ✅       | A Momento API key with access to the target cache                          |                                              |
| `momento.cacheName`       | `string`                 | ✅       | Name of the Momento cache to use for agent discovery and metadata storage  |                                              |
| `bedrock.region`          | `string`                 | ❌       | AWS region for Bedrock service                                             | Provided in runtime                          |
| `bedrock.modelId`         | `string`                 | ❌       | Bedrock model identifier                                                   | `'amazon.nova-lite-v1:0'` |
| `bedrock.accessKeyId`     | `string`                 | ❌       | AWS access key id to use                                                   | Provided in runtime                          |
| `bedrock.secretAccessKey` | `string`                 | ❌       | AWS secret access key to use                                               | Provided in runtime                          |
| `bedrock.profile`         | `string`                 | ❌       | AWS profile to use for invocation                                          | `default`                                    |
| `tools`                   | `Array<{ name, description, schema, handler }>` | ❌ | Additional tools exposed to the LLM (Zod schema + handler shape matches `invokeAgent`) | `[]`                           |
| `config.maxTokens`        | `number`                 | ❌       | Maximum tokens for Bedrock responses                                       | `4096`                                       |
| `config.agentLoadingConcurrency` | `number`          | ❌       | Max number of concurrent agent card loads                                  | `3`                                          |
| `config.debug`            | `boolean`                | ❌       | Enable detailed logging for debugging                                      | `false`                                      |
| `config.tokenWarningThreshold` | `number`            | ❌       | Aborts execution when token usage exceeds this approximate value           | `3200`     |
| `config.preserveThinkingTags` | `boolean`            | ❌       | Indicate whether to include `<thinking>` tags from the llm in the response | `false`    |
| `config.systemPrompt`     | `string`                 | ❌       | Additional system instructions appended to the model prompt                 |                                              |
##### Supported Models

Please refer to the [AWS documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/models-features.html) to find the list of available AI models with their features.

##### `SendMessageParams`

Both orchestrators support the same message parameters:

| Property        | Type                                  | Required | Description                                                                 |
|-----------------|---------------------------------------|----------|-----------------------------------------------------------------------------|
| `message`       | `string`                              | ✅       | The user message to route and respond to                                    |
| `contextId`     | `string`                              | ❌       | Optional context ID to use for invocation and continuity across sessions    |
| `publishUpdate` | `(text: string) => Promise<void>`     | ❌       | Optional callback for publishing status updates during orchestration        |

##### `StreamChunk`

| Property | Type                      | Description                                      |
|----------|---------------------------|--------------------------------------------------|
| `type`   | `'chunk'` \| `'final'`    | Indicates whether it's a partial or final chunk |
| `text`   | `string`                  | Text content of the chunk                        |

#### Registering agents

Before sending messages, both orchestrators need to know which agents they can delegate to. You can provide agent URLs in two ways:

##### 1. Via `registerAgents()`

You can explicitly register agents using their public URLs. These should point to agents that expose a valid `/.well-known/agent.json`.

```ts
orchestrator.registerAgents([
  'https://weather.agent',
  'https://calendar.agent'
]);
```

This will trigger background loading of agent cards. Any orchestration call (like sendMessage) will wait for these agents to finish loading before running.

##### 2. Via Momento agent registry

If you have agents registered in the Momento agent list (i.e., they were created with registerAgent: true in createMomentoAgent), the orchestrator will discover and load them automatically. These are read from the cache key defined in AGENT_LIST.

You can combine both sources: any agents passed to registerAgents() will be merged with agents discovered from the registry.

##### Agent card caching

Agent cards are cached in Momento so that repeat calls do not require fetching from the network. If a card is not already cached, the orchestrator will fetch it from the agent's /.well-known/agent.json endpoint and store it automatically.

## Local MCP Server

This package includes a built-in **Model Context Protocol (MCP)** server that runs locally via the CLI. It enables models like Claude or GPT-4o to use your A2A agents as external tools using `mcp_servers`.

### Running the MCP Server

```bash
npx momento-a2a-agent
```

You'll see:

```bash
A2A MCP Server running on stdio
```

This starts an MCP server over stdio exposing the `invokeAgent` tool, which lets models call other A2A agents.

### Exposed Tools

#### `invokeAgent`

| Field       | Type     | Description                                                      |
| ----------- | -------- | ---------------------------------------------------------------- |
| `agentUrl`  | `string` | The base URL of the A2A agent to invoke                          |
| `message`   | `string` | The instruction or user message to pass to the agent             |
| `taskId`    | `string` | Optional ID to associate multiple invocations with the same task |
| `contextId` | `string` | ID used to group related tasks (required by A2A protocol)        |

This tool returns the final text output from the agent, allowing your LLM to route through it as a tool in a broader workflow.

> Note: The MCP server runs over `stdio`, so you'll typically embed this in a CLI tool or adapter process that's called from the model runtime.

## Links

* [A2A protocol spec](https://google-a2a.github.io/A2A/latest/)
* [Momento Topics](https://gomomento.com/products/topics/)
* [Momento Cache](https://gomomento.com/products/cache/)
* [A2A reference and examples](https://github.com/google-a2a/a2a-js)

## License

See [LICENSE](./LICENSE).

*Want more examples or a deep dive? Open an issue or PR!*
