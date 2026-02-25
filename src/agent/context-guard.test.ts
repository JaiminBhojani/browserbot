import { describe, it, expect } from 'vitest';
import {
    estimateTokens,
    truncateToolOutput,
    estimateContextSize,
    compactOldToolResults,
    stripImagesFromHistory,
    guardContext,
} from './context-guard.js';
import type { AgentMessage } from './providers/base.js';

describe('estimateTokens', () => {
    it('returns approximate token count based on character length', () => {
        // ~1 token per 3.5 chars
        expect(estimateTokens('hello')).toBeGreaterThan(0);
        expect(estimateTokens('a'.repeat(350))).toBe(100);
    });

    it('returns 0 for empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });
});

describe('truncateToolOutput', () => {
    it('passes through short outputs unchanged', () => {
        const output = '{"ok": true}';
        expect(truncateToolOutput(output)).toBe(output);
    });

    it('truncates long outputs with 70/20/10 split', () => {
        const output = 'A'.repeat(20_000);
        const result = truncateToolOutput(output);

        expect(result.length).toBeLessThan(output.length);
        expect(result).toContain('characters truncated');
        // Should have head + marker + tail
        expect(result.length).toBeLessThanOrEqual(16_500); // 16K + marker
    });

    it('respects custom maxChars', () => {
        const output = 'x'.repeat(5000);
        const result = truncateToolOutput(output, 1000);

        expect(result.length).toBeLessThan(output.length);
        expect(result).toContain('characters truncated');
    });

    it('preserves head and tail content', () => {
        const head = 'HEAD_MARKER_';
        const middle = 'M'.repeat(20_000);
        const tail = '_TAIL_MARKER';
        const output = head + middle + tail;

        const result = truncateToolOutput(output);

        expect(result.startsWith(head)).toBe(true);
        expect(result.endsWith(tail)).toBe(true);
    });
});

describe('compactOldToolResults', () => {
    it('keeps recent messages intact', () => {
        const messages: AgentMessage[] = [
            { role: 'user', content: 'hello' },
            { role: 'tool', content: { content: 'x'.repeat(1000) } as any },
            { role: 'assistant', content: 'response' },
        ];

        const result = compactOldToolResults(messages, 6);
        // All 3 messages are within the keepRecent threshold
        expect(result[1].content).toEqual(messages[1].content);
    });

    it('compacts old tool results beyond keepRecent', () => {
        const messages: AgentMessage[] = Array.from({ length: 10 }, (_, i) => ({
            role: 'tool' as const,
            content: { content: `Result ${i}: ${'data'.repeat(100)}` } as any,
        }));

        const result = compactOldToolResults(messages, 4);

        // First 6 should be compacted
        const firstContent = (result[0].content as any).content;
        expect(firstContent).toContain('[compacted]');

        // Last 4 should be intact
        const lastContent = (result[9].content as any).content;
        expect(lastContent).not.toContain('[compacted]');
    });
});

// describe('stripImagesFromHistory', () => {
//     it('removes base64 content from tool results', () => {
//         const messages: AgentMessage[] = [
//             {
//                 role: 'tool',
//                 content: { content: '{"screenshot":"data:image/png;base64,abc123"}' } as any,
//             },
//         ];

//         const result = stripImagesFromHistory(messages);
//         const content = (result[0].content as any).content;
//         expect(content).not.toContain('abc123');
//         expect(content).toContain('[removed to save tokens]');
//     });

//     it('strips image blocks from assistant messages', () => {
//         const messages: AgentMessage[] = [
//             {
//                 role: 'assistant',
//                 content: [
//                     { type: 'text', text: 'Here is the result' },
//                     { type: 'image', source: { type: 'base64', data: 'abc' } },
//                 ],
//             },
//         ];

//         const result = stripImagesFromHistory(messages);
//         const content = result[0].content as any[];
//         expect(content[1].type).toBe('text');
//         expect(content[1].text).toBe('[image removed]');
//     });
// });

describe('guardContext', () => {
    it('returns messages unchanged if within limit', () => {
        const messages: AgentMessage[] = [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ];

        const result = guardContext(messages, 200_000);
        expect(result).toEqual(messages);
    });

    it('compacts when approaching limit', () => {
        // Create messages that would exceed a small context window
        // Each message has ~5000 chars → ~1430 tokens
        // 20 messages → ~28,600 tokens total
        const messages: AgentMessage[] = Array.from({ length: 20 }, (_, i) => ({
            role: 'tool' as const,
            content: {
                content: `Large result ${i}: ${'x'.repeat(5000)}`,
            } as any,
        }));

        // Use a context window smaller than the total estimated tokens
        // to force compaction. Reserve 100 so threshold = 400 tokens (way less than actual)
        const result = guardContext(messages, 500, 100);

        // Should have compacted some messages
        const compactedCount = result.filter(
            m => (m.content as any)?.content?.includes('[compacted]')
        ).length;
        expect(compactedCount).toBeGreaterThan(0);
    });
});
