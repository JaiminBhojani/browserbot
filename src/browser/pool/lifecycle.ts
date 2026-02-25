import { contextManager } from './context-manager.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'browser-lifecycle' });

export interface LifecycleConfig {
    idleTimeoutMs: number;    // destroy context after this idle period
    maxContexts: number;      // max simultaneous user contexts
    gcIntervalMs: number;     // how often to sweep for idle contexts
}

const DEFAULT_CONFIG: LifecycleConfig = {
    idleTimeoutMs: 5 * 60 * 1000,   // 5 minutes idle → cleanup
    maxContexts: 5,
    gcIntervalMs: 60 * 1000,        // sweep every 60 seconds
};

/**
 * LifecycleManager — garbage collects idle browser contexts.
 *
 * Why this matters: Playwright BrowserContexts hold real memory (~100MB each).
 * Users who stop chatting shouldn't keep browser processes alive forever.
 * This sweeper runs every minute, destroys contexts idle > 5 min.
 *
 * Also enforces maxContexts — evicts the oldest idle context when full.
 */
class LifecycleManager {
    private config: LifecycleConfig = DEFAULT_CONFIG;
    private gcTimer: NodeJS.Timeout | null = null;

    configure(config: Partial<LifecycleConfig>): void {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    start(): void {
        if (this.gcTimer) return; // already running

        log.info(
            {
                idleTimeoutMs: this.config.idleTimeoutMs,
                maxContexts: this.config.maxContexts,
                gcIntervalMs: this.config.gcIntervalMs,
            },
            'Browser lifecycle manager started'
        );

        this.gcTimer = setInterval(() => this.sweep(), this.config.gcIntervalMs);
        // Don't block Node.js shutdown
        this.gcTimer.unref();
    }

    stop(): void {
        if (this.gcTimer) {
            clearInterval(this.gcTimer);
            this.gcTimer = null;
            log.info('Browser lifecycle manager stopped');
        }
    }

    /**
     * Called before creating a new context — enforces the maxContexts cap.
     * If at limit, evicts the least-recently-used idle context.
     */
    async enforceLimit(): Promise<void> {
        if (contextManager.size < this.config.maxContexts) return;

        log.warn(
            { current: contextManager.size, max: this.config.maxContexts },
            'Context limit reached — evicting oldest idle context'
        );

        const all = contextManager.getAll();
        const sorted = all.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
        const oldest = sorted[0];

        if (oldest) {
            log.info({ userId: oldest.userId }, 'Evicting context');
            await contextManager.destroyContext(oldest.userId);
        }
    }

    private async sweep(): Promise<void> {
        const now = Date.now();
        const all = contextManager.getAll();

        const idle = all.filter(
            (ctx) => now - ctx.lastActivityAt > this.config.idleTimeoutMs
        );

        if (idle.length === 0) return;

        log.info({ count: idle.length }, 'Sweeping idle browser contexts');

        for (const ctx of idle) {
            log.info(
                {
                    userId: ctx.userId,
                    idleSec: Math.floor((now - ctx.lastActivityAt) / 1000),
                },
                'Destroying idle context'
            );
            await contextManager.destroyContext(ctx.userId);
        }
    }
}

export const lifecycleManager = new LifecycleManager();