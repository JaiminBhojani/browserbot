import { describe, it, expect } from 'vitest';
import { configSchema } from './schema.js';

describe('Config Schema', () => {
  it('parses empty config with all defaults', () => {
    const result = configSchema.parse({});

    expect(result.gateway.port).toBe(18789);
    expect(result.gateway.host).toBe('0.0.0.0');
    expect(result.providers.primary.provider).toBe('anthropic');
    expect(result.browser.headless).toBe(true);
    expect(result.browser.maxContexts).toBe(5);
    expect(result.channels.whatsapp.enabled).toBe(true);
    expect(result.security.maxActionsPerRequest).toBe(25);
    expect(result.memory.enabled).toBe(true);
  });

  it('accepts custom values', () => {
    const result = configSchema.parse({
      gateway: { port: 3000 },
      browser: { headless: false, maxContexts: 10 },
      channels: {
        whatsapp: {
          allowedNumbers: ['+911234567890'],
        },
      },
    });

    expect(result.gateway.port).toBe(3000);
    expect(result.browser.headless).toBe(false);
    expect(result.browser.maxContexts).toBe(10);
    expect(result.channels.whatsapp.allowedNumbers).toEqual(['+911234567890']);
  });

  it('rejects invalid maxContexts', () => {
    expect(() =>
      configSchema.parse({
        browser: { maxContexts: 50 },
      })
    ).toThrow();
  });

  it('rejects invalid provider', () => {
    expect(() =>
      configSchema.parse({
        providers: {
          primary: { provider: 'invalid', model: 'test' },
        },
      })
    ).toThrow();
  });
});
