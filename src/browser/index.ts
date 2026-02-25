import { browserPool, BrowserPoolConfig } from './pool/browser-pool.js';
import { contextManager } from './pool/context-manager.js';
import { lifecycleManager, LifecycleConfig } from './pool/lifecycle.js';  // ← was .ts, now .js
import { logger } from '../infra/logger.js';

const log = logger.child({ module: 'browser-engine' });

export interface BrowserEngineConfig extends BrowserPoolConfig, Partial<LifecycleConfig> { }

export class BrowserEngine {
    private started = false;

    async start(config: Partial<BrowserEngineConfig> = {}): Promise<void> {
        if (this.started) return;

        log.info('Starting browser engine...');

        browserPool.configure({
            headless: config.headless ?? true,
            navigationTimeoutMs: config.navigationTimeoutMs ?? 30_000,
        });

        lifecycleManager.configure({
            idleTimeoutMs: config.idleTimeoutMs ?? 5 * 60 * 1000,
            maxContexts: config.maxContexts ?? 5,
        });

        lifecycleManager.start();
        this.started = true;

        log.info('Browser engine ready');
    }

    async stop(): Promise<void> {
        log.info('Stopping browser engine...');
        lifecycleManager.stop();
        await browserPool.close();
        this.started = false;
        log.info('Browser engine stopped');
    }

    async getPageForUser(userId: string) {
        await lifecycleManager.enforceLimit();
        const ctx = await contextManager.getOrCreate(userId);
        return ctx.activePage;
    }

    async isHealthy(): Promise<boolean> {
        return browserPool.isHealthy();
    }
}

export const browserEngine = new BrowserEngine();

export { contextManager } from './pool/context-manager.js';
export * from './actions/index.js';
export * from './extraction/extraction.js';
export * from './vision/screenshot.js';