# Requirements Document

## Introduction

This feature adds an agent type property to distinguish between "worker" agents (standard task executors) and "supervisor" agents (orchestrators). When an agent is created with type "supervisor", the system automatically publishes status updates when tools are invoked, providing visibility into orchestration progress. This enhancement maintains the existing agent architecture while adding observability for orchestration workflows.

## Glossary

- **Agent**: A Momento-powered A2A agent created via createMomentoAgent
- **Worker Agent**: An agent with type "worker" that executes specific tasks (default type)
- **Supervisor Agent**: An agent with type "supervisor" that orchestrates conversations and invokes tools
- **Agent Type**: A property that distinguishes between worker and supervisor agents
- **Tool**: A function that can be invoked by a supervisor agent during orchestration
- **Status Update Event**: A TaskStatusUpdateEvent that communicates task state changes to subscribers
- **PublishUpdateFn**: A callback function provided to handlers for publishing status updates
- **Event Bus**: The MomentoEventBus that publishes and subscribes to agent execution events

## Requirements

### Requirement 1

**User Story:** As a developer using the agent framework, I want to specify an agent type when creating an agent, so that I can distinguish between worker agents and supervisor agents

#### Acceptance Criteria

1. THE createMomentoAgent function SHALL accept an optional type parameter
2. THE type parameter SHALL accept values "worker" or "supervisor"
3. WHERE type is not provided, THE createMomentoAgent function SHALL default to "worker"
4. THE createMomentoAgent function SHALL pass the agent type to MomentoAgentExecutor
5. THE agent type SHALL be immutable after agent creation

### Requirement 2

**User Story:** As a developer monitoring agents, I want all status updates to include the agent type, so that I can distinguish between worker and supervisor events

#### Acceptance Criteria

1. THE MomentoAgentExecutorOptions SHALL accept an optional agentType parameter
2. THE MomentoAgentExecutor SHALL store the agent type
3. THE MomentoAgentExecutor SHALL include agentType in all published TaskStatusUpdateEvent metadata
4. THE agentType metadata field SHALL contain either "worker" or "supervisor"
5. WHERE agentType is not provided to MomentoAgentExecutor, THE agentType SHALL default to "worker"

### Requirement 3

**User Story:** As a developer creating a supervisor agent, I want the orchestrator to automatically publish status updates when tools are invoked, so that I can track orchestration progress without manual instrumentation

#### Acceptance Criteria

1. THE orchestrator SHALL receive the publishUpdate callback from the handler context
2. THE orchestrator SHALL call publishUpdate before invoking each tool
3. THE orchestrator SHALL call publishUpdate after each tool completes
4. THE orchestrator SHALL call publishUpdate when a tool fails
5. THE status update messages SHALL follow the format "Invoking tool: {toolName}", "Tool {toolName} completed successfully", or "Tool {toolName} failed: {error}"

### Requirement 4

**User Story:** As a developer creating orchestration handlers, I want to call publishUpdate for tool invocations, so that status updates are automatically published

#### Acceptance Criteria

1. THE orchestration handler SHALL call publishUpdate before invoking each tool
2. THE publishUpdate call SHALL include the tool name in the format "Invoking tool: {toolName}"
3. THE orchestration handler SHALL call publishUpdate after each tool completes
4. WHERE the tool succeeds, THE publishUpdate call SHALL use the format "Tool {toolName} completed successfully"
5. WHERE the tool fails, THE publishUpdate call SHALL use the format "Tool {toolName} failed: {errorMessage}"

### Requirement 5

**User Story:** As a developer using the agent framework, I want backward compatibility for existing agents, so that they continue to function without modification

#### Acceptance Criteria

1. WHERE type is not specified in createMomentoAgent, THE agent SHALL behave as a worker agent
2. THE existing agent code SHALL continue to function without modification
3. THE existing status updates SHALL include agentType "worker" in metadata
4. THE createMomentoAgent API SHALL remain compatible with existing code
5. THE TaskStatusUpdateEvent structure SHALL remain compatible with existing consumers

### Requirement 6

**User Story:** As a developer creating a supervisor agent, I want the unified creation functions to handle orchestrator setup, so that I don't need to write boilerplate code

#### Acceptance Criteria

1. THE createBedrockAgent function SHALL create and configure the orchestrator when type is "supervisor"
2. THE createOpenAIAgent function SHALL create and configure the orchestrator when type is "supervisor"
3. THE unified functions SHALL auto-discover agents from the registry
4. THE unified functions SHALL create a handler that passes publishUpdate to the orchestrator
5. THE unified functions SHALL not introduce additional complexity for worker agents

### Requirement 7

**User Story:** As a developer debugging orchestration, I want tool invocation status updates to include relevant information, so that I can understand what the supervisor is doing

#### Acceptance Criteria

1. THE tool invocation status update SHALL include the tool name in the message text
2. THE tool result status update SHALL include the tool name in the message text
3. THE tool failure status update SHALL include the tool name and error message in the message text
4. THE status updates SHALL use the "working" task state
5. THE status updates SHALL include timestamps in ISO 8601 format

### Requirement 8

**User Story:** As a developer using supervisor agents, I want status updates to be published through the same event bus as worker agents, so that I have a consistent monitoring experience

#### Acceptance Criteria

1. THE supervisor agent SHALL use MomentoAgentExecutor for task execution
2. THE supervisor agent SHALL publish events through the MomentoEventBus
3. THE supervisor agent SHALL use the same TaskStatusUpdateEvent structure as worker agents
4. THE supervisor status updates SHALL be indistinguishable from worker status updates except for the agentType metadata
5. THE supervisor agent SHALL use the publishUpdate callback provided by MomentoAgentExecutor

### Requirement 9

**User Story:** As a developer creating a supervisor agent, I want to use the same createMomentoAgent function as worker agents, so that I have a consistent API

#### Acceptance Criteria

1. THE createMomentoAgent function SHALL accept the same parameters for both worker and supervisor agents
2. THE createMomentoAgent function SHALL return the same type for both worker and supervisor agents
3. THE supervisor agent SHALL support all the same capabilities as worker agents (streaming, state history, etc.)
4. THE supervisor agent SHALL generate an AgentCard like worker agents
5. THE supervisor agent SHALL be discoverable and usable like worker agents

### Requirement 10

**User Story:** As a developer, I want unified functions to create Bedrock and OpenAI agents, so that I have a consistent API regardless of agent type

#### Acceptance Criteria

1. THE package SHALL export a createBedrockAgent function
2. THE package SHALL export a createOpenAIAgent function
3. THE createBedrockAgent function SHALL accept a type parameter with values "worker" or "supervisor"
4. THE createOpenAIAgent function SHALL accept a type parameter with values "worker" or "supervisor"
5. THE functions SHALL return the same type as createMomentoAgent

### Requirement 11

**User Story:** As a developer creating a worker agent with createBedrockAgent or createOpenAIAgent, I want to provide custom tools, so that the orchestrator can invoke them with automatic status updates

#### Acceptance Criteria

1. WHEN type is "worker", THE createBedrockAgent function SHALL require a tools parameter
2. WHEN type is "worker", THE createOpenAIAgent function SHALL require a tools parameter
3. THE tools parameter SHALL be an array of tool definitions with name, description, schema, and handler
4. THE worker agent SHALL use an orchestrator with the provided custom tools
5. THE worker agent SHALL publish status updates when tools are invoked

### Requirement 12

**User Story:** As a developer creating a supervisor agent with createBedrockAgent or createOpenAIAgent, I want agents to be auto-discovered as tools, so that I don't need to manually register them

#### Acceptance Criteria

1. WHEN type is "supervisor", THE createBedrockAgent function SHALL not require a tools parameter
2. WHEN type is "supervisor", THE createOpenAIAgent function SHALL not require a tools parameter
3. WHEN type is "supervisor", THE function SHALL create an orchestrator internally
4. THE orchestrator SHALL automatically discover agents from the Momento agent registry
5. THE discovered agents SHALL be registered as tools in the orchestrator

### Requirement 13

**User Story:** As a developer creating a supervisor agent, I want to configure the orchestrator, so that I can control model selection and behavior

#### Acceptance Criteria

1. THE createBedrockAgent function SHALL accept optional bedrock configuration parameters
2. THE createBedrockAgent function SHALL accept optional config parameters for orchestrator settings
3. THE createOpenAIAgent function SHALL accept optional openai configuration parameters
4. THE createOpenAIAgent function SHALL accept optional config parameters for orchestrator settings
5. THE configuration parameters SHALL match the orchestrator constructor parameters

### Requirement 14

**User Story:** As a developer using createBedrockAgent or createOpenAIAgent, I want the orchestrator to receive the publishUpdate callback, so that tool invocation status updates are published

#### Acceptance Criteria

1. THE supervisor handler SHALL extract text from the message parts
2. THE supervisor handler SHALL pass the message text to the orchestrator
3. THE supervisor handler SHALL pass the contextId to the orchestrator
4. THE supervisor handler SHALL pass the publishUpdate callback to the orchestrator
5. THE supervisor handler SHALL return the orchestrator response as the handler result
