import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    LLMProvider,
    LLMProviderConfig,
    LLMResponse,
    AgentMessage,
    ToolDefinition,
    ToolCallContent,
} from './base.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'provider:google' });

export class GoogleProvider implements LLMProvider {
    readonly name = 'google';
    readonly model: string;

    private client: GoogleGenerativeAI;
    private maxTokens: number;

    constructor(config: LLMProviderConfig) {
        this.client = new GoogleGenerativeAI(config.apiKey);
        this.model = config.model ?? 'gemini-2.5-flash';
        this.maxTokens = config.maxTokens ?? 4096;
    }

    async complete(
        systemPrompt: string,
        messages: AgentMessage[],
        tools: ToolDefinition[]
    ): Promise<LLMResponse> {
        const model = this.client.getGenerativeModel({
            model: this.model,
            systemInstruction: systemPrompt,
            tools: tools.length > 0
                ? [{ functionDeclarations: this.toGoogleTools(tools) }]
                : undefined,
            generationConfig: { maxOutputTokens: this.maxTokens },
        });

        // Convert all messages into Google's content array
        const contents = this.toGoogleContents(messages);

        log.debug({ model: this.model, turns: contents.length }, 'Calling Google');

        // Use generateContent (not startChat) for full control over history
        const result = await model.generateContent({ contents });

        return this.parseResponse(result.response);
    }

    // ─── Convert our AgentMessage[] → Google Content[] ──────────────────────
    //
    // Google rules:
    //   - roles must be 'user' or 'model' (not 'assistant', 'tool', 'system')
    //   - must alternate user → model → user → model
    //   - tool results go as functionResponse inside a 'user' role part
    //   - tool calls go as functionCall inside a 'model' role part
    //   - consecutive same-role messages must be merged into one

    private toGoogleContents(messages: AgentMessage[]): any[] {
        const raw: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

        for (const m of messages) {
            // Skip system messages — handled via systemInstruction
            if (m.role === 'system') continue;

            if (m.role === 'user') {
                const text = typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content);
                raw.push({ role: 'user', parts: [{ text }] });

            } else if (m.role === 'assistant') {
                const parts: any[] = [];

                if (Array.isArray(m.content)) {
                    for (const c of m.content as any[]) {
                        if (c.type === 'text' && c.text) {
                            parts.push({ text: c.text });
                        }
                        if (c.type === 'tool_call') {
                            // Google functionCall part
                            parts.push({
                                functionCall: {
                                    name: c.name,
                                    args: c.arguments ?? {},
                                },
                            });
                        }
                    }
                } else if (typeof m.content === 'string' && m.content) {
                    parts.push({ text: m.content });
                }

                if (parts.length > 0) {
                    raw.push({ role: 'model', parts });
                }

            } else if (m.role === 'tool') {
                // Tool results must be 'user' role with functionResponse parts
                const content = m.content as any;
                const toolName = content.name ?? 'unknown_tool';
                const toolContent = content.content ?? JSON.stringify(content);

                let responseValue: any;
                try {
                    responseValue = JSON.parse(toolContent);
                } catch {
                    responseValue = { result: toolContent };
                }

                raw.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: toolName,
                            response: responseValue,
                        },
                    }],
                });
            }
        }

        // Merge consecutive same-role messages into one
        // Google requires strict alternation: user → model → user → model
        return this.mergeConsecutive(raw);
    }

    private mergeConsecutive(
        contents: Array<{ role: 'user' | 'model'; parts: any[] }>
    ): Array<{ role: 'user' | 'model'; parts: any[] }> {
        if (contents.length === 0) return [];

        const merged: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

        for (const item of contents) {
            const last = merged[merged.length - 1];
            if (last && last.role === item.role) {
                // Same role — merge parts into the previous entry
                last.parts.push(...item.parts);
            } else {
                merged.push({ role: item.role, parts: [...item.parts] });
            }
        }

        return merged;
    }

    // ─── Tool definitions → Google FunctionDeclaration format ───────────────

    private toGoogleTools(tools: ToolDefinition[]): any[] {
        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description.slice(0, 200),
            parameters: {
                type: 'OBJECT',
                properties: Object.fromEntries(
                    Object.entries(tool.parameters).map(([key, param]) => [
                        key,
                        {
                            type: param.type.toUpperCase(),
                            description: param.description.slice(0, 100),
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

    // ─── Parse Google response → common LLMResponse format ──────────────────

    private parseResponse(response: any): LLMResponse {
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const toolCalls: ToolCallContent[] = [];
        let text = '';

        for (const part of parts) {
            if (part.text) {
                text += part.text;
            }
            if (part.functionCall) {
                toolCalls.push({
                    type: 'tool_call',
                    // Google doesn't provide IDs — generate one
                    id: `gcall-${part.functionCall.name}-${Date.now()}`,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args ?? {},
                });
            }
        }

        const finishReason = candidate?.finishReason;
        const stopReason =
            toolCalls.length > 0 ? 'tool_use'
                : finishReason === 'MAX_TOKENS' ? 'max_tokens'
                    : 'end_turn';

        return { stopReason, text, toolCalls };
    }
}