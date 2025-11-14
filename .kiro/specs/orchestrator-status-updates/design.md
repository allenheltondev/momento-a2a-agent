# Design Document

## Overview

This design adds an agent `type` property to distinguish between "worker" agents and "supervisor" agents. The key insight is that **both types use the same Agent implementation** (AmazonBedrockAgent or OpenAIAgent) - they just differ in their configuration:

- **Worker Agent**: Agent with custom tools + user-defined prompt
- **Supervisor Agent**: Agent with custom tools + invokeAgent tool + orchestration system prompt

The key changes are:
- Add optional `type` property to agent configuration (defaults to "worker")
- Include agent type in all published status update metadata
- Update Agent implementations (AmazonBedrockAgent, OpenAIAgent) to accept and use `publishUpdate` callback for tool invocation status
- Provide unified `createBedrockAgent` and `createOpenAIAgent` functions that:
  - For workers: create Agent with custom tools and user prompt
  - For supervisors: create Agent with custom tools + invokeAgent tool + orchestration system prompt
- Both types get automatic status updates for tool invocations via `publishUpdate`

## Architecture

### High-Level Flow

**Worker Agent:**
```
createBedrockAgent({ type: "worker", tools: [...], prompt: "...", ... })
  ↓
  Create AmazonBedrockAgent with:
    - Custom tools
    - User-defined prompt
  ↓
  Create handler that calls agent.sendMessage(text, contextId, publishUpdate)
  ↓
  Call createMomentoAgent with handler and type: "worker"
  ↓
  Return A2A server with agentType: "worker" metadata
```

**Supervisor Agent:**
```
createBedrockAgent({ type: "supervisor", tools: [...], ... })
  ↓
  Create AmazonBedrockAgent with:
    - Custom tools (if provided)
    - invokeAgent tool (auto-added)
    - Orchestration system prompt (injected)
  ↓
  Auto-discover and register worker agents from registry
  ↓
  Create handler that calls agent.sendMessage(text, contextId, publishUpdate)
  ↓
  Call createMomentoAgent with handler and type: "supervisor"
  ↓
  Return A2A server with agentType: "supervisor" metadata
```

**Key insight:** Same Agent implementation, same handler pattern, different configuration (tools + prompt).

### Component Interactions

```
┌─────────────────────────────────────┐
│  createMomentoAgent                 │
│  - type: "worker" | "supervisor"    │
└──────────────┬──────────────────────┘
               │
               │ creates
               ↓
┌─────────────────────────────────────┐
│  MomentoAgentExecutor               │
│  - agentType in metadata            │
│  - wrapped handler (if supervisor)  │
└──────────────┬──────────────────────┘
               │
               │ publishes to
               ↓
┌─────────────────────────────────────┐
│  MomentoEventBus                    │
│  - TaskStatusUpdateEvent            │
│    with agentType metadata          │
└─────────────────────────────────────┘
```

## Components and Interfaces

### 1. Agent Type Definition

Add a type to distinguish agent roles:

```typescript
export type AgentType = "worker" | "supervisor";
```

### 2. Enhanced createMomentoAgent Parameters

Update the function signature to accept agent type:

```typescript
export async function createMomentoAgent(params: {
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateMomentoAgentOptions;
  type?: AgentType;  // NEW: Defaults to "worker"
}) {
  // Implementation
}
```

### 3. Enhanced MomentoAgentExecutorOptions

Update executor options to include agent type:

```typescript
export interface MomentoAgentExecutorOptions {
  agentName?: string;
  agentId?: string;
  agentType?: AgentType;  // NEW: Defaults to "worker"
}
```

### 4. Simplified createMomentoAgent

No special wrapping needed - just pass the type through:

```typescript
export async function createMomentoAgent(params: {
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateMomentoAgentOptions;
  type?: AgentType;
}) {
  const { type = 'worker', ...rest } = params;

  // ... existing agent card creation ...

  // Pass agentType to executor
  const executor = new MomentoAgentExecutor(params.handler, {
    agentName: agentCardFull.name,
    agentId: agentCardFull.name.replace(/\s+/g, '_').toLowerCase(),
    agentType: type,
  });

  // ... rest of existing logic ...
}
```



### 5. Updated MomentoAgentExecutor

Include agent type in published metadata:

```typescript
export class MomentoAgentExecutor {
  private readonly handleTask: HandleTaskFn;
  private readonly agentName?: string;
  private readonly agentId?: string;
  private readonly agentType: AgentType;  // NEW

  constructor(handleTask: HandleTaskFn, opts?: MomentoAgentExecutorOptions) {
    this.handleTask = handleTask;
    this.agentName = opts?.agentName;
    this.agentId = opts?.agentId;
    this.agentType = opts?.agentType || 'worker';  // NEW
  }

  async execute(message: Message, eventBus: IExecutionEventBus, context: { task?: Task; }): Promise<void> {
    // ... existing initialization code ...

    const workingUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: task.id,
      contextId: task.contextId,
      status: {
        state: "working",
        message,
        timestamp: new Date().toISOString(),
      },
      final: false,
      metadata: {
        agentName: this.agentName,
        agentId: this.agentId,
        agentType: this.agentType,  // NEW
      },
    };
    await eventBus.publish(workingUpdate);

    const publishUpdate: PublishUpdateFn = async (text: string) => {
      const statusUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: task.id,
        contextId: task.contextId,
        status: {
          state: "working",
          message: {
            ...message,
            parts: [{ kind: "text", text }],
          },
          timestamp: new Date().toISOString(),
        },
        final: false,
        metadata: {
          agentName: this.agentName,
          agentId: this.agentId,
          agentType: this.agentType,  // NEW
        },
      };
      await eventBus.publish(statusUpdate);
    };

    // ... rest of execution logic ...

    const completedUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: resultTask.id,
      contextId: resultTask.contextId,
      status: {
        state: resultTask.status.state,
        message: resultTask.status.message!,
        timestamp: resultTask.status.timestamp ?? new Date().toISOString(),
      },
      final: true,
      metadata: {
        agentName: this.agentName,
        agentId: this.agentId,
        agentType: this.agentType,  // NEW
      },
    };
    await eventBus.publish(completedUpdate);
  }
}
```

### 6. Agent Integration - SendMessageParams Enhancement

Update the Agent implementations (AmazonBedrockAgent, OpenAIAgent) to accept an optional `publishUpdate` callback:

```typescript
// In both AmazonBedrockAgent and OpenAIAgent

export type SendMessageParams = {
  message: string;
  contextId?: string;
  publishUpdate?: (text: string) => Promise<void>;  // NEW
};
```

The Agent implementations will call `publishUpdate` before and after each tool invocation:

```typescript
// In AmazonBedrockAgent.sendMessage() and sendMessageStream()
for (const toolUseItem of toolUseItems) {
  const { toolUse } = toolUseItem;
  const { name: toolName, input: toolInput, toolUseId } = toolUse;

  // NEW: Publish tool invocation status
  if (params.publishUpdate) {
    await params.publishUpdate(`Invoking tool: ${toolName}`);
  }

  let toolResult: any;
  let toolError: string | undefined;

  try {
    const tool = tools.find(t => t.spec.name === toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    toolResult = await tool.handler(toolInput);
  } catch (error: any) {
    toolError = error.message;
    toolResult = { error: error.message };
  }

  // NEW: Publish tool result status
  if (params.publishUpdate) {
    const resultMessage = toolError
      ? `Tool ${toolName} failed: ${toolError}`
      : `Tool ${toolName} completed successfully`;
    await params.publishUpdate(resultMessage);
  }

  toolResults.push({
    toolUseId,
    content: [{ text: JSON.stringify(toolResult) }]
  });
}
```

### 7. Unified Agent Creation Functions

Create unified functions that handle both worker and supervisor agent creation based on the `type` parameter:

```typescript
// Shared configuration types
type BedrockConfig = {
  modelId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  profile?: string;
};

type OpenAIConfig = {
  apiKey: string;
  model?: string;
};

type OrchestratorConfig = {
  agentLoadingConcurrency?: number;
  systemPrompt?: string;
  maxTokens?: number;
  tokenWarningThreshold?: number;
  debug?: boolean;
  preserveThinkingTags?: boolean;
};

type Tool = {
  name: string;
  description: string;
  schema: any;
  handler: (input: any) => Promise<any> | any;
};

// Worker agent with custom tools
type WorkerBedrockParams = {
  type: 'worker';
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  tools: Tool[];
  agentCard?: Partial<AgentCard>;
  bedrock?: BedrockConfig;
  config?: OrchestratorConfig;
  options?: CreateMomentoAgentOptions;
};

type WorkerOpenAIParams = {
  type: 'worker';
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  tools: Tool[];
  agentCard?: Partial<AgentCard>;
  openai: OpenAIConfig;
  config?: OrchestratorConfig;
  options?: CreateMomentoAgentOptions;
};

// Supervisor agent with auto-discovered agents
type SupervisorBedrockParams = {
  type: 'supervisor';
  cacheName: string;
  apiKey: string;
  agentCard?: Partial<AgentCard>;
  bedrock?: BedrockConfig;
  config?: OrchestratorConfig;
  options?: CreateMomentoAgentOptions;
};

type SupervisorOpenAIParams = {
  type: 'supervisor';
  cacheName: string;
  apiKey: string;
  agentCard?: Partial<AgentCard>;
  openai: OpenAIConfig;
  config?: OrchestratorConfig;
  options?: CreateMomentoAgentOptions;
};

// Bedrock agent creation function
export async function createBedrockAgent(
  params: WorkerBedrockParams | SupervisorBedrockParams
) {
  // Create orchestrator (same for both types)
  const orchestrator = new AmazonBedrockOrchestrator({
    momento: {
      apiKey: params.apiKey,
      cacheName: params.cacheName
    },
    bedrock: params.bedrock,
    config: params.config
  });

  if (params.type === 'worker') {
    // Worker: register custom tools
    orchestrator.registerTools(params.tools);
  } else {
    // Supervisor: auto-discover agents from registry
    orchestrator.registerAgents([]);

    // Wait for agents to load
    await new Promise(resolve => {
      const checkReady = () => {
        if (orchestrator.isReady()) {
          resolve(undefined);
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  // Same handler pattern for both types
  const handler: HandleTaskFn = async (message, { publishUpdate }) => {
    const textPart = message.parts.find(p => p.kind === 'text' && 'text' in p);
    const text = textPart && 'text' in textPart ? textPart.text : '';

    const response = await orchestrator.sendMessage({
      message: text,
      contextId: message.contextId,
      publishUpdate
    });

    return response || 'No response';
  };

  // Create agent with appropriate type
  return createMomentoAgent({
    cacheName: params.cacheName,
    apiKey: params.apiKey,
    skills: params.type === 'worker' ? params.skills : (params.agentCard?.skills || [{
      id: 'orchestrate',
      name: 'Orchestrate',
      description: 'Coordinates multiple agents to complete complex tasks',
      tags: ['orchestration']
    }]),
    handler,
    agentCard: params.agentCard,
    options: params.options,
    type: params.type
  });
}

// OpenAI agent creation function (same pattern as Bedrock)
export async function createOpenAIAgent(
  params: WorkerOpenAIParams | SupervisorOpenAIParams
) {
  // Create orchestrator (same for both types)
  const orchestrator = new OpenAIOrchestrator({
    momento: {
      apiKey: params.apiKey,
      cacheName: params.cacheName
    },
    openai: params.openai,
    config: params.config
  });

  if (params.type === 'worker') {
    // Worker: register custom tools
    orchestrator.registerTools(params.tools);
  } else {
    // Supervisor: auto-discover agents from registry
    orchestrator.registerAgents([]);

    // Wait for agents to load
    await new Promise(resolve => {
      const checkReady = () => {
        if (orchestrator.isReady()) {
          resolve(undefined);
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  // Same handler pattern for both types
  const handler: HandleTaskFn = async (message, { publishUpdate }) => {
    const textPart = message.parts.find(p => p.kind === 'text' && 'text' in p);
    const text = textPart && 'text' in textPart ? textPart.text : '';

    const response = await orchestrator.sendMessage({
      message: text,
      contextId: message.contextId,
      publishUpdate
    });

    return response || 'No response';
  };

  // Create agent with appropriate type
  return createMomentoAgent({
    cacheName: params.cacheName,
    apiKey: params.apiKey,
    skills: params.type === 'worker' ? params.skills : (params.agentCard?.skills || [{
      id: 'orchestrate',
      name: 'Orchestrate',
      description: 'Coordinates multiple agents to complete complex tasks',
      tags: ['orchestration']
    }]),
    handler,
    agentCard: params.agentCard,
    options: params.options,
    type: params.type
  });
}

**Key benefits:**
- Both worker and supervisor agents use orchestrators
- Both get automatic `publishUpdate` calls for tool invocations
- Only difference is tool source: custom tools vs auto-discovered agents
- Consistent API and behavior across both types
```

### Usage Examples

**Worker Agent with Custom Tools:**
```typescript
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
      location: z.string()
    }),
    handler: async (input) => {
      // Custom weather logic
      return { temp: 72, condition: 'Sunny' };
    }
  }],
  bedrock: {
    modelId: 'amazon.nova-micro-v1:0'
  }
});
// Worker gets automatic publishUpdate calls when getWeather tool is invoked
```

**Supervisor Agent with Auto-Discovered Agents:**
```typescript
const supervisorAgent = await createBedrockAgent({
  type: 'supervisor',
  cacheName: 'ai',
  apiKey: process.env.MOMENTO_API_KEY,
  agentCard: {
    name: 'Task Coordinator',
    description: 'Coordinates multiple agents',
    url: 'https://supervisor.example.com'
  },
  bedrock: {
    modelId: 'amazon.nova-pro-v1:0'
  },
  config: {
    maxTokens: 4000,
    debug: true
  }
});
// Supervisor gets automatic publishUpdate calls when invoking discovered agents
```

## Data Models

### TaskStatusUpdateEvent with Agent Type

Status updates now include agent type in metadata:

```typescript
{
  kind: 'status-update',
  taskId: string,
  contextId: string,
  final: boolean,
  status: {
    state: TaskState,
    timestamp: string,
    message: {
      kind: 'message',
      messageId: string,
      role: 'agent',
      parts: [
        {
          kind: 'text',
          text: string  // e.g., "Invoking tool: invokeAgent"
        }
      ],
      contextId: string,
      taskId: string
    }
  },
  metadata: {
    agentName?: string,
    agentId?: string,
    agentType: 'worker' | 'supervisor',  // NEW
  }
}
```

## Error Handling

### Type Validation

- Invalid agent types are rejected at the `createMomentoAgent` level
- Agent type defaults to "worker" if not specified
- Type validation occurs before executor creation

### Status Update Publishing

- Status updates use the existing `publishUpdate` callback
- Publishing errors are handled by MomentoAgentExecutor
- Tool execution continues even if status updates fail

### Handler Wrapping

- Supervisor handler wrapper catches and logs errors
- Original handler errors are propagated normally
- Wrapper does not interfere with error handling flow

## Testing Strategy

### Unit Tests

1. **Agent Type Support**
   - Test that agent type defaults to "worker"
   - Test that agent type is included in status update metadata
   - Test that supervisor type is correctly set

2. **Handler Wrapping**
   - Test that supervisor handlers are wrapped correctly
   - Test that worker handlers are not wrapped
   - Test that wrapped handlers preserve original behavior

3. **Status Update Publishing**
   - Test that publishUpdate is called for tool invocations
   - Test that publishUpdate is called for tool results
   - Test that status updates include correct agent type

4. **Backward Compatibility**
   - Test that existing agents work without type parameter
   - Test that worker agents behave identically to before
   - Test that metadata structure remains compatible

### Integration Tests

1. **Supervisor Agent Creation**
   - Test creating a supervisor agent with createMomentoAgent
   - Verify agent type is set to "supervisor"
   - Verify status updates include supervisor type

2. **Tool Invocation Flow**
   - Test supervisor agent invoking tools
   - Verify status updates are published for each tool
   - Verify status updates include tool names and results

3. **Event Bus Integration**
   - Test that supervisor events are received by subscribers
   - Verify event ordering and consistency
   - Test concurrent worker and supervisor agents

### Manual Testing

1. Create test script that:
   - Creates both worker and supervisor agents
   - Subscribes to status update events
   - Sends messages that trigger tool invocations
   - Logs all received status updates with agent type

2. Verify:
   - Worker agents show agentType "worker"
   - Supervisor agents show agentType "supervisor"
   - Tool invocation messages are clear and informative
   - Status updates appear in correct order
