import OpenAI from 'openai';
import {
    LLMProvider,
    LLMProviderConfig,
    LLMResponse,
    AgentMessage,
    ToolDefinition,
    ToolCallContent,
} from './base.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'provider:groq' });

export class GroqProvider implements LLMProvider {
    readonly name = 'groq';
    readonly model: string;

    private client: OpenAI;
    private maxTokens: number;

    constructor(config: LLMProviderConfig) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.groq.com/openai/v1',
        });
        this.model = config.model ?? 'llama-3.3-70b-versatile';
        this.maxTokens = config.maxTokens ?? 4096;
    }

    async complete(
        systemPrompt: string,
        messages: AgentMessage[],
        tools: ToolDefinition[]
    ): Promise<LLMResponse> {
        const openaiMessages = this.toOpenAIMessages(systemPrompt, messages);
        const openaiTools = this.toOpenAITools(tools);

        log.debug({ model: this.model, messages: openaiMessages.length }, 'Calling Groq');

        // ATTEMPT 1: with tools
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                max_tokens: 1024,
                tools: openaiTools,
                tool_choice: 'auto',
                parallel_tool_calls: false,
                messages: openaiMessages,
            });
            return this.parseResponse(response);
        } catch (err: any) {
            const isFunctionError =
                err.message?.includes('400') && err.message?.includes('Failed to call a function');

            if (!isFunctionError) throw err; // not a function error — rethrow

            log.warn({ model: this.model }, 'Groq function call failed, retrying without tools');
        }

        // ATTEMPT 2: without tools (pure text — Groq handles simple chat)
        const response = await this.client.chat.completions.create({
            model: this.model,
            max_tokens: 1024,
            messages: openaiMessages,
        });
        return this.parseResponse(response);
    }

    // ─── CONVERSION: common → OpenAI/Groq format ───────────────────────────────

    private toOpenAIMessages(
        systemPrompt: string,
        messages: AgentMessage[]
    ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
        ];

        for (const m of messages) {
            if (m.role === 'system') continue; // already added above

            if (m.role === 'tool') {
                const content = m.content as any;
                result.push({
                    role: 'tool',
                    tool_call_id: content.tool_call_id ?? content[0]?.tool_call_id,
                    content: typeof content === 'string' ? content : content.content ?? JSON.stringify(content),
                });
                continue;
            }

            if (m.role === 'assistant' && Array.isArray(m.content)) {
                const toolCalls = (m.content as any[]).filter((c: any) => c.type === 'tool_call');
                const textContent = (m.content as any[]).find((c: any) => c.type === 'text');

                if (toolCalls.length > 0) {
                    result.push({
                        role: 'assistant',
                        content: textContent?.text ?? null,
                        tool_calls: toolCalls.map((tc: any) => ({
                            id: tc.id,
                            type: 'function' as const,
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.arguments),
                            },
                        })),
                    });
                    continue;
                }
            }

            result.push({
                role: m.role as any,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            });
        }

        return result;
    }

    private toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return tools.map((tool) => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description.slice(0, 150),
                parameters: {
                    type: 'object' as const,
                    properties: Object.fromEntries(
                        Object.entries(tool.parameters).map(([key, param]) => [
                            key,
                            {
                                type: 'string',           // ← force ALL params to string type
                                description: param.description.slice(0, 80),
                                ...(param.enum ? { enum: param.enum } : {}),
                            },
                        ])
                    ),
                    required: Object.entries(tool.parameters)
                        .filter(([, p]) => p.required)
                        .map(([k]) => k),
                },
            },
        }));
    }

    // ─── PARSE OpenAI/Groq response → common format ────────────────────────────

    private parseResponse(response: OpenAI.Chat.Completions.ChatCompletion): LLMResponse {
        const choice = response.choices[0];
        const message = choice.message;
        const toolCalls: ToolCallContent[] = [];

        if (message.tool_calls?.length) {
            for (const tc of message.tool_calls) {
                if (tc.type !== 'function') continue;
                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(tc.function.arguments);
                } catch { /* keep empty */ }

                toolCalls.push({
                    type: 'tool_call',
                    id: tc.id,
                    name: tc.function.name,
                    arguments: args,
                });
            }
        }

        const stopReason =
            choice.finish_reason === 'tool_calls'
                ? 'tool_use'
                : choice.finish_reason === 'stop'
                    ? 'end_turn'
                    : choice.finish_reason === 'length'
                        ? 'max_tokens'
                        : 'end_turn';

        return {
            stopReason,
            text: message.content ?? '',
            toolCalls,
        };
    }
}