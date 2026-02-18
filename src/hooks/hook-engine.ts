import { createChildLogger } from '../infra/logger.js';

const log = createChildLogger('hooks');

/**
 * All lifecycle hook names in the system.
 */
export type HookName =
  | 'onGatewayStart'
  | 'onGatewayStop'
  | 'onMessageInbound'
  | 'beforeAgentRun'
  | 'afterAgentRun'
  | 'beforeBrowserAction'
  | 'afterBrowserAction'
  | 'onPageLoad'
  | 'onScreenshot'
  | 'onApprovalRequired'
  | 'onSessionCreate'
  | 'onSessionDestroy'
  | 'onError';

export type HookHandler = (context: Record<string, unknown>) => Promise<void> | void;

interface RegisteredHook {
  name: string;       // plugin/module name that registered this
  handler: HookHandler;
  priority: number;   // lower = runs first
}

/**
 * Central Hook Engine — manages lifecycle events throughout the system.
 * Plugins and internal modules register handlers for hooks.
 * When a hook fires, all registered handlers run in priority order.
 */
export class HookEngine {
  private hooks: Map<HookName, RegisteredHook[]> = new Map();

  /**
   * Register a handler for a hook.
   */
  register(hookName: HookName, name: string, handler: HookHandler, priority = 100): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    this.hooks.get(hookName)!.push({ name, handler, priority });

    // Sort by priority (lower first)
    this.hooks.get(hookName)!.sort((a, b) => a.priority - b.priority);

    log.debug(`Hook registered: ${hookName} by "${name}" (priority: ${priority})`);
  }

  /**
   * Unregister all handlers from a specific source.
   */
  unregister(name: string): void {
    for (const [hookName, handlers] of this.hooks.entries()) {
      const filtered = handlers.filter((h) => h.name !== name);
      if (filtered.length !== handlers.length) {
        this.hooks.set(hookName, filtered);
        log.debug(`Unregistered hooks from "${name}" for ${hookName}`);
      }
    }
  }

  /**
   * Fire a hook — runs all registered handlers in priority order.
   * Errors in individual handlers are caught and logged, not thrown.
   */
  async fire(hookName: HookName, context: Record<string, unknown> = {}): Promise<void> {
    const handlers = this.hooks.get(hookName);
    if (!handlers || handlers.length === 0) return;

    log.debug(`Firing hook: ${hookName} (${handlers.length} handlers)`);

    for (const { name, handler } of handlers) {
      try {
        await handler(context);
      } catch (err) {
        log.error({ err, hook: hookName, source: name }, `Hook handler error`);
        // Fire onError hook (but don't recurse)
        if (hookName !== 'onError') {
          await this.fire('onError', { error: err, hook: hookName, source: name });
        }
      }
    }
  }

  /**
   * Get count of registered handlers per hook (for debugging).
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [hookName, handlers] of this.hooks.entries()) {
      stats[hookName] = handlers.length;
    }
    return stats;
  }
}
