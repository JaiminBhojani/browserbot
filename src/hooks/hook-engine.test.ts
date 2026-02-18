import { describe, it, expect, vi } from 'vitest';
import { HookEngine } from './hook-engine.js';

describe('HookEngine', () => {
  it('fires registered hooks', async () => {
    const engine = new HookEngine();
    const handler = vi.fn();

    engine.register('onGatewayStart', 'test', handler);
    await engine.fire('onGatewayStart', { port: 18789 });

    expect(handler).toHaveBeenCalledWith({ port: 18789 });
  });

  it('fires hooks in priority order', async () => {
    const engine = new HookEngine();
    const order: number[] = [];

    engine.register('onGatewayStart', 'low', async () => { order.push(1); }, 10);
    engine.register('onGatewayStart', 'high', async () => { order.push(3); }, 300);
    engine.register('onGatewayStart', 'mid', async () => { order.push(2); }, 100);

    await engine.fire('onGatewayStart');

    expect(order).toEqual([1, 2, 3]);
  });

  it('catches handler errors without throwing', async () => {
    const engine = new HookEngine();
    const goodHandler = vi.fn();

    engine.register('onGatewayStart', 'bad', async () => { throw new Error('boom'); });
    engine.register('onGatewayStart', 'good', goodHandler, 200);

    // Should not throw
    await engine.fire('onGatewayStart');

    // Good handler should still run
    expect(goodHandler).toHaveBeenCalled();
  });

  it('unregisters hooks by name', async () => {
    const engine = new HookEngine();
    const handler = vi.fn();

    engine.register('onGatewayStart', 'test', handler);
    engine.unregister('test');
    await engine.fire('onGatewayStart');

    expect(handler).not.toHaveBeenCalled();
  });

  it('returns stats', () => {
    const engine = new HookEngine();
    engine.register('onGatewayStart', 'a', async () => {});
    engine.register('onGatewayStart', 'b', async () => {});
    engine.register('onError', 'c', async () => {});

    const stats = engine.getStats();
    expect(stats.onGatewayStart).toBe(2);
    expect(stats.onError).toBe(1);
  });
});
