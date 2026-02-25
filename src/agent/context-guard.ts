import { AgentMessage } from './providers/base.js';
import { logger } from '../infra/logger.js';

const log = logger.child({ module: 'context-guard' });

// ─── TOKEN ESTIMATION ─────────────────────────────────────────────────────────

/**
 * Rough token estimation: ~1 token per 4 characters for English text.
 * This is intentionally conservative (over-estimates) to avoid hitting limits.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

// ─── TOOL OUTPUT TRUNCATION ───────────────────────────────────────────────────

const DEFAULT_MAX_CHARS = 16_000; // ~4K tokens

/**
 * Truncate tool output to prevent single-tool responses from
 * dominating the context window.
 *
 * Uses a 70/20/10 split:
 * - 70% head (most important info is at the top)
 * - 20% tail (error messages often appear at the end)
 * - 10% marker text
 */
export function truncateToolOutput(
    output: string,
    maxChars: number = DEFAULT_MAX_CHARS
): string {
    if (output.length <= maxChars) return output;

    const headSize = Math.floor(maxChars * 0.7);
    const tailSize = Math.floor(maxChars * 0.2);

    const head = output.slice(0, headSize);
    const tail = output.slice(-tailSize);
    const removed = output.length - headSize - tailSize;

    log.debug({ original: output.length, truncatedTo: maxChars }, 'Tool output truncated');

    return `${head}\n\n[... ${removed} characters truncated ...]\n\n${tail}`;
}

// ─── CONTEXT SIZE ESTIMATION ──────────────────────────────────────────────────

/**
 * Estimate total token count across all messages in the conversation.
 */
export function estimateContextSize(messages: AgentMessage[]): number {
    let totalChars = 0;

    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if ('text' in block) {
                    totalChars += (block as any).text.length;
                } else if ('content' in block) {
                    totalChars += (block as any).content.length;
                }
                // Image blocks are estimated separately
                if ((block as any).type === 'image') {
                    totalChars += 20_000; // ~5K tokens per image
                }
            }
        } else if (typeof msg.content === 'object' && msg.content !== null) {
            // Handle tool results stored as { content: "..." }
            const contentStr = (msg.content as any).content;
            if (typeof contentStr === 'string') {
                totalChars += contentStr.length;
            }
        }
    }

    return Math.ceil(totalChars / 3.5);
}

// ─── HISTORY COMPACTION ───────────────────────────────────────────────────────

/**
 * Compact old tool results by replacing them with a short summary.
 * Keeps only the most recent `keepRecent` messages fully intact.
 */
export function compactOldToolResults(
    messages: AgentMessage[],
    keepRecent: number = 6
): AgentMessage[] {
    return messages.map((m, index) => {
        const isRecent = index >= messages.length - keepRecent;
        if (isRecent) return m;

        if (m.role === 'tool') {
            const content = m.content as any;
            const resultStr: string = content.content ?? '';

            // Already compacted
            if (resultStr.length < 200) return m;

            // Compact: keep first 100 chars as hint
            const hint = resultStr.slice(0, 100).replace(/\n/g, ' ');
            return {
                ...m,
                content: {
                    ...content,
                    content: `[compacted] ${hint}...`,
                },
            };
        }

        // Strip image blocks from old assistant messages
        if (m.role === 'assistant' && Array.isArray(m.content)) {
            return {
                ...m,
                content: (m.content as any[]).map(c =>
                    c.type === 'image' ? { type: 'text', text: '[image removed]' } : c
                ),
            };
        }

        return m;
    });
}

/**
 * Emergency: strip ALL images and base64 content from history.
 * Called when context overflow is detected.
 */
export function stripImagesFromHistory(messages: AgentMessage[]): AgentMessage[] {
    return messages.map(m => {
        // Strip from tool results
        if (m.role === 'tool') {
            const content = m.content as any;
            const resultStr: string = content.content ?? '';

            if (resultStr.includes('base64') || resultStr.includes('"screenshot"')) {
                return {
                    ...m,
                    content: {
                        ...content,
                        content: '{"ok":true,"screenshot":"[removed to save tokens]"}',
                    },
                };
            }
        }

        // Strip from assistant messages
        if (m.role === 'assistant' && Array.isArray(m.content)) {
            return {
                ...m,
                content: (m.content as any[]).map(c =>
                    c.type === 'image' ? { type: 'text', text: '[image removed]' } : c
                ),
            };
        }

        return m;
    });
}

// ─── PROACTIVE CONTEXT CHECK ──────────────────────────────────────────────────

/**
 * Check if the context is approaching the limit and apply compaction.
 *
 * @param messages - Current conversation messages
 * @param contextWindow - Provider's context window size in tokens
 * @param reserveTokens - Tokens to keep free for the response (default: 30K)
 * @returns Potentially compacted messages
 */
export function guardContext(
    messages: AgentMessage[],
    contextWindow: number,
    reserveTokens: number = 30_000
): AgentMessage[] {
    const threshold = contextWindow - reserveTokens;
    let currentSize = estimateContextSize(messages);

    log.debug(
        { currentSize, threshold, contextWindow },
        'Context guard check'
    );

    if (currentSize <= threshold) {
        return messages;
    }

    // Level 1: Compact old tool results
    log.warn({ currentSize, threshold }, 'Context approaching limit — compacting old tool results');
    let compacted = compactOldToolResults(messages);
    currentSize = estimateContextSize(compacted);

    if (currentSize <= threshold) {
        return compacted;
    }

    // Level 2: Strip all images
    log.warn({ currentSize, threshold }, 'Still over limit — stripping images');
    compacted = stripImagesFromHistory(compacted);

    return compacted;
}
