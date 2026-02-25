import { ToolResult } from '../../browser/tools/index.js';

// ─── COMMON MESSAGE TYPES ─────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface TextContent {
    type: 'text';
    text: string;
}

export interface ToolCallContent {
    type: 'tool_call';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolResultContent {
    type: 'tool_result';
    tool_call_id: string;
    content: string;
}

export type MessageContent =
    | string
    | TextContent[]
    | ToolCallContent[]
    | ToolResultContent[];

export interface AgentMessage {
    role: MessageRole;
    content: MessageContent;
}

// ─── TOOL DEFINITION ─────────────────────────────────────────────────────────

export interface ToolParameter {
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    enum?: string[];
    default?: unknown;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, ToolParameter>;
}

// ─── PROVIDER RESPONSE ───────────────────────────────────────────────────────

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface LLMResponse {
    stopReason: StopReason;
    /** Text the model produced (may be empty if only tool calls) */
    text: string;
    /** Tool calls the model wants to make */
    toolCalls: ToolCallContent[];
}

// ─── PROVIDER INTERFACE ───────────────────────────────────────────────────────

export interface LLMProviderConfig {
    apiKey: string;
    model: string;
    maxTokens?: number;
}

/**
 * LLMProvider — the contract every provider must implement.
 * 
 * Adding a new LLM = implement this interface in a new file.
 * The agent loop never imports Anthropic or Groq SDK directly.
 */
export interface LLMProvider {
    readonly name: string;
    readonly model: string;

    /**
     * Send messages to the LLM and get a response.
     * The provider handles all SDK-specific formatting internally.
     */
    complete(
        systemPrompt: string,
        messages: AgentMessage[],
        tools: ToolDefinition[]
    ): Promise<LLMResponse>;
}

// ─── PROVIDER CATALOG ─────────────────────────────────────────────────────────

export interface ProviderCatalogEntry {
    provider: string;
    models: string[];
    contextWindow: number;
    supportsVision: boolean;
    supportsToolUse: boolean;
    notes?: string;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
    {
        provider: 'anthropic',
        models: [
            'claude-haiku-4-5-20251001',
            'claude-sonnet-4-20250514',
            'claude-opus-4-20250514',
        ],
        contextWindow: 200_000,
        supportsVision: true,
        supportsToolUse: true,
    },
    {
        provider: 'groq',
        models: [
            'llama-3.3-70b-versatile',
            'llama3-70b-8192',
            'mixtral-8x7b-32768',
            'gemma2-9b-it',
        ],
        contextWindow: 32_768,
        supportsVision: false,
        supportsToolUse: true,
        notes: 'Free tier: 500K tokens/min. Fastest inference.',
    },
    {
        provider: 'openai',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        contextWindow: 128_000,
        supportsVision: true,
        supportsToolUse: true,
    },
    {
        provider: 'google',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        contextWindow: 1_000_000,
        supportsVision: true,
        supportsToolUse: true,
        notes: 'Free tier: 250K tokens/min.',
    },
];