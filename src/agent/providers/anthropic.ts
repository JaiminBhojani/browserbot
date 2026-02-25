import Anthropic from '@anthropic-ai/sdk';
import {
    LLMProvider,
    LLMProviderConfig,
    LLMResponse,
    AgentMessage,
    ToolDefinition,
    ToolCallContent,
} from './base.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'provider:anthropic' });

export class AnthropicProvider implements LLMProvider {
    readonly name = 'anthropic';
    readonly model: string;

    private client: Anthropic;
    private maxTokens: number;

    constructor(config: LLMProviderConfig) {
        this.client = new Anthropic({ apiKey: config.apiKey });
        this.model = config.model ?? 'claude-haiku-4-5-20251001';
        this.maxTokens = config.maxTokens ?? 4096;
    }

    async complete(
        systemPrompt: string,
        messages: AgentMessage[],
        tools: ToolDefinition[]
    ): Promise<LLMResponse> {
        // Convert common messages → Anthropic format
        const anthropicMessages = this.toAnthropicMessages(messages);
        const anthropicTools = this.toAnthropicTools(tools);

        log.debug({ model: this.model, messages: messages.length }, 'Calling Anthropic');

        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: systemPrompt,
            tools: anthropicTools as any,
            messages: anthropicMessages as any,
        });

        return this.parseResponse(response);
    }

    // ─── CONVERSION: common → Anthropic ────────────────────────────────────────

    private toAnthropicMessages(messages: AgentMessage[]): any[] {
        return messages
            .filter((m) => m.role !== 'system') // system goes in system param
            .map((m) => {
                if (m.role === 'tool') {
                    // Tool result message
                    const content = m.content as any;
                    return {
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: content.tool_call_id ?? content[0]?.tool_call_id,
                                content: typeof content === 'string' ? content : content.content ?? JSON.stringify(content),
                            },
                        ],
                    };
                }

                if (m.role === 'assistant' && Array.isArray(m.content)) {
                    // Assistant message with tool calls
                    return {
                        role: 'assistant',
                        content: (m.content as any[]).map((c: any) => {
                            if (c.type === 'tool_call') {
                                return {
                                    type: 'tool_use',
                                    id: c.id,
                                    name: c.name,
                                    input: c.arguments,
                                };
                            }
                            return { type: 'text', text: c.text ?? c };
                        }),
                    };
                }

                return {
                    role: m.role,
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                };
            });
    }

    private toAnthropicTools(tools: ToolDefinition[]): any[] {
        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: {
                type: 'object',
                properties: Object.fromEntries(
                    Object.entries(tool.parameters).map(([key, param]) => [
                        key,
                        {
                            type: param.type,
                            description: param.description,
                            ...(param.enum ? { enum: param.enum } : {}),
                        },
                    ])
                ),
                required: Object.entries(tool.parameters)
                    .filter(([, p]) => p.required)
                    .map(([k]) => k),
            },
        }));
    }

    // ─── PARSE Anthropic response → common format ───────────────────────────────

    private parseResponse(response: Anthropic.Message): LLMResponse {
        let text = '';
        const toolCalls: ToolCallContent[] = [];

        for (const block of response.content) {
            if (block.type === 'text') {
                text += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    type: 'tool_call',
                    id: block.id,
                    name: block.name,
                    arguments: block.input as Record<string, unknown>,
                });
            }
        }

        const stopReason =
            response.stop_reason === 'tool_use'
                ? 'tool_use'
                : response.stop_reason === 'end_turn'
                    ? 'end_turn'
                    : response.stop_reason === 'max_tokens'
                        ? 'max_tokens'
                        : 'end_turn';

        return { stopReason, text, toolCalls };
    }
}