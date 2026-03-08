import { LLMProvider, AgentMessage, PROVIDER_CATALOG } from '../providers/base.js';
import { createProviderFromConfig } from '../providers/factory.js';
import { toolRegistry } from '../tools/registry.js';
import { browserEngine } from '../../browser/index.js';
import { truncateToolOutput, guardContext } from '../context-guard.js';
import { memoryStore } from '../memory/memory-store.js';
import { logger } from '../../infra/logger.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const log = logger.child({ module: 'agent-loop' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../prompt/templates');

const MAX_ITERATIONS = 25;

export type { AgentMessage };

export interface AgentRunOptions {
    userId: string;
    userMessage: string;
    conversationHistory: AgentMessage[];
    onToken?: (token: string) => void;
    onToolCall?: (name: string) => void;
}

export interface AgentRunResult {
    finalResponse: string;
    toolCallCount: number;
    updatedHistory: AgentMessage[];
    providerUsed: string;
}

/**
 * AgentLoop — provider-agnostic think → act → observe loop.
 *
 * Works with ANY LLMProvider (Google, Anthropic, Groq, OpenAI, etc).
 * Supports a full provider chain — tries each in order on failure.
 * Adding a new LLM = add a provider file + register in factory.ts.
 * This file never needs to change.
 */
export class AgentLoop {
    private providers: LLMProvider[];
    // System prompt is NOT cached globally anymore — it's rebuilt per user
    // so that memory context is always fresh for each session.

    constructor(primary: LLMProvider, ...fallbacks: LLMProvider[]) {
        this.providers = [primary, ...fallbacks];
    }

    get primaryProvider(): LLMProvider {
        return this.providers[0];
    }

    /**
     * Get the context window size for the active provider.
     * Used by guardContext to know when to compact.
     */
    private getContextWindow(): number {
        const providerName = this.providers[0].name;
        const entry = PROVIDER_CATALOG.find(e => e.provider === providerName);
        return entry?.contextWindow ?? 128_000; // conservative default
    }

    private async getSystemPrompt(userId: string): Promise<string> {
        const [identity, browsing, safety] = await Promise.all([
            readFile(join(TEMPLATES_DIR, 'IDENTITY.md'), 'utf-8').catch(() => ''),
            readFile(join(TEMPLATES_DIR, 'BROWSING.md'), 'utf-8').catch(() => ''),
            readFile(join(TEMPLATES_DIR, 'SAFETY.md'), 'utf-8').catch(() => ''),
        ]);

        const parts: string[] = [
            identity,
            browsing,
            safety,
            `\nCurrent date/time: ${new Date().toISOString()}`,
        ].filter(Boolean);

        // Inject per-user memory context (preferences + recent activity)
        // This is done here — NOT via a tool call — so the LLM always has
        // full context from the very first message of each session.
        const memoryBlock = memoryStore.buildContextBlock(userId);
        if (memoryBlock) {
            parts.push(memoryBlock);
            log.debug({ userId }, 'Memory context injected into system prompt');
        }

        return parts.join('\n\n---\n\n');
    }

    /**
     * Call LLM with automatic provider chain fallback.
     * Tries each provider in order: Google → Anthropic → Groq
     * Falls through to next on rate limit, auth, or bad function call errors.
     */
    private async callLLM(
        systemPrompt: string,
        messages: AgentMessage[],
        tools: ReturnType<typeof toolRegistry.getToolDefinitions>
    ): Promise<{ response: Awaited<ReturnType<LLMProvider['complete']>>; providerUsed: string }> {
        let lastError: any;

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];
            const isLast = i === this.providers.length - 1;

            try {
                const response = await provider.complete(systemPrompt, messages, tools);
                return { response, providerUsed: provider.name };
            } catch (err: any) {
                lastError = err;

                const shouldFallback =
                    err.message?.includes('429') ||
                    err.message?.includes('rate_limit') ||
                    err.message?.includes('401') ||
                    err.message?.includes('authentication') ||
                    err.message?.includes('503') ||
                    err.message?.includes('overloaded') ||
                    err.message?.includes('prompt is too long') ||
                    (err.message?.includes('400') && (
                        err.message?.includes('Failed to call a function') ||
                        err.message?.includes('tool call validation failed') ||
                        err.message?.includes('which was not in request.tools') ||
                        err.message?.includes('failed_generation')
                    ));

                if (shouldFallback && !isLast) {
                    const nextProvider = this.providers[i + 1];
                    log.warn(
                        {
                            from: provider.name,
                            to: nextProvider.name,
                            error: err.message,
                        },
                        'Provider failed, trying next in chain'
                    );
                    continue;
                }

                // Last provider or non-recoverable error — throw
                throw err;
            }
        }

        throw lastError ?? new Error('All providers failed');
    }

    async run(options: AgentRunOptions): Promise<AgentRunResult> {
        const { userId, userMessage, conversationHistory, onToken, onToolCall } = options;

        await browserEngine.getPageForUser(userId);

        // Rebuild system prompt per session so memory context is always fresh
        const systemPrompt = await this.getSystemPrompt(userId);
        const tools = toolRegistry.getToolDefinitions();

        const messages: AgentMessage[] = [
            ...conversationHistory,
            { role: 'user', content: userMessage },
        ];

        let toolCallCount = 0;
        let finalResponse = '';
        let providerUsed = this.primaryProvider.name;

        log.info({ userId, provider: this.primaryProvider.name }, 'Agent loop starting');

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            log.info({ userId, iteration }, 'Agent iteration');

            // Proactive context guard: compact if approaching token limit
            const guardedMessages = guardContext(
                messages,
                this.getContextWindow()
            );

            const { response, providerUsed: usedThisTurn } = await this.callLLM(
                systemPrompt,
                guardedMessages,
                tools
            );
            providerUsed = usedThisTurn;

            log.info(
                { userId, stopReason: response.stopReason, toolCalls: response.toolCalls.length },
                'LLM responded'
            );

            // ── CASE 1: Text response — done ──────────────────────────────────
            if (response.stopReason === 'end_turn' || response.toolCalls.length === 0) {
                finalResponse = response.text;
                onToken?.(finalResponse);
                messages.push({ role: 'assistant', content: response.text });
                break;
            }

            // ── CASE 2: Tool calls ─────────────────────────────────────────────
            if (response.stopReason === 'tool_use' || response.toolCalls.length > 0) {
                // Stream any thinking text before tool calls
                if (response.text) {
                    onToken?.(response.text + '\n');
                }

                // Save assistant message with tool calls
                const assistantContent: any[] = [];
                if (response.text) {
                    assistantContent.push({ type: 'text', text: response.text });
                }
                for (const tc of response.toolCalls) {
                    assistantContent.push(tc);
                }
                messages.push({ role: 'assistant', content: assistantContent });

                // Execute each tool call
                for (const toolCall of response.toolCalls) {
                    toolCallCount++;
                    onToolCall?.(toolCall.name);

                    log.info({ userId, tool: toolCall.name }, 'Executing tool');

                    const result = await toolRegistry.dispatch(
                        toolCall.name,
                        toolCall.arguments,
                        userId
                    );

                    log.info(
                        { userId, tool: toolCall.name, success: result.success, error: result.error },
                        'Tool result'
                    );

                    const resultContent = result.success
                        ? JSON.stringify(result.data ?? { ok: true })
                        : `ERROR: ${result.error}`;

                    // Truncate large tool outputs to prevent single-tool context bloat
                    const guardedContent = truncateToolOutput(resultContent);

                    messages.push({
                        role: 'tool',
                        content: {
                            tool_call_id: toolCall.id,
                            name: toolCall.name,
                            content: guardedContent,
                        } as any,
                    });
                }

                continue;
            }

            // ── CASE 3: Max tokens or unexpected ──────────────────────────────
            log.warn({ userId, stopReason: response.stopReason }, 'Unexpected stop reason');
            finalResponse = 'I ran into an issue completing that task. Please try again.';
            break;
        }

        if (!finalResponse && toolCallCount >= MAX_ITERATIONS) {
            finalResponse = "I wasn't able to complete the task within the allowed steps.";
        }

        const updatedHistory = messages.slice(conversationHistory.length);

        log.info(
            { userId, toolCallCount, providerUsed, responseLength: finalResponse.length },
            'Agent loop complete'
        );

        return { finalResponse, toolCallCount, updatedHistory, providerUsed };
    }
}

// ─── SINGLETON ────────────────────────────────────────────────────────────────

let agentLoop: AgentLoop | null = null;

export function initAgentLoop(config: {
    providers: {
        primary: { provider: string; model: string; apiKey?: string };
        fallback?: { provider: string; model: string; apiKey?: string };
        fallback2?: { provider: string; model: string; apiKey?: string };
        [key: string]: { provider: string; model: string; apiKey?: string } | undefined;
    };
}): AgentLoop {
    const { primary, fallbacks } = createProviderFromConfig(config);

    agentLoop = new AgentLoop(primary, ...fallbacks);

    log.info(
        {
            primary: primary.name,
            model: primary.model,
            fallbacks: fallbacks.map((f) => f.name),
        },
        'Agent loop initialized'
    );

    return agentLoop;
}

export function getAgentLoop(): AgentLoop {
    if (!agentLoop) {
        throw new Error('Agent loop not initialized — call initAgentLoop() first');
    }
    return agentLoop;
}