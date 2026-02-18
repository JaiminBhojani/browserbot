import { describe, it, expect } from 'vitest';
import { chunkMessage, isCommand, parseCommand } from './dispatch.js';

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = chunkMessage('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('splits long messages at paragraph breaks', () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const result = chunkMessage(text, 4096);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(para1);
    expect(result[1]).toBe(para2);
  });

  it('handles very long single-word text', () => {
    const text = 'A'.repeat(10000);
    const result = chunkMessage(text, 4096);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('isCommand', () => {
  it('detects slash commands', () => {
    expect(isCommand('/help')).toBe(true);
    expect(isCommand('/status')).toBe(true);
    expect(isCommand('  /help  ')).toBe(true);
  });

  it('rejects non-commands', () => {
    expect(isCommand('hello')).toBe(false);
    expect(isCommand('search for /something')).toBe(false);
    expect(isCommand('')).toBe(false);
  });
});

describe('parseCommand', () => {
  it('parses command without args', () => {
    expect(parseCommand('/help')).toEqual({ command: 'help', args: '' });
    expect(parseCommand('/STATUS')).toEqual({ command: 'status', args: '' });
  });

  it('parses command with args', () => {
    expect(parseCommand('/model gpt-4o')).toEqual({ command: 'model', args: 'gpt-4o' });
    expect(parseCommand('/search hello world')).toEqual({ command: 'search', args: 'hello world' });
  });
});
