import { chromium, Browser } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'browser-pool' });

export interface BrowserPoolConfig {
    headless: boolean;
    navigationTimeoutMs: number;
}

const DEFAULT_CONFIG: BrowserPoolConfig = {
    headless: true,
    navigationTimeoutMs: 30_000,
};

/**
 * BrowserPool — singleton that owns the one shared Chromium process.
 * All users share this single browser instance but get isolated
 * BrowserContexts (via ContextManager) so their cookies/sessions never mix.
 */
class BrowserPool {
    private browser: Browser | null = null;
    private config: BrowserPoolConfig = DEFAULT_CONFIG;
    private launchPromise: Promise<Browser> | null = null;

    configure(config: Partial<BrowserPoolConfig>): void {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Get (or lazily launch) the shared Chromium browser.
     * Safe to call concurrently — only one launch happens.
     */
    async getBrowser(): Promise<Browser> {
        // Already running
        if (this.browser?.isConnected()) return this.browser;

        // Launch in progress — wait for it
        if (this.launchPromise) return this.launchPromise;

        // Start a fresh launch
        this.launchPromise = this.launch();
        try {
            this.browser = await this.launchPromise;
            return this.browser;
        } finally {
            this.launchPromise = null;
        }
    }

    private async launch(): Promise<Browser> {
        log.info({ headless: this.config.headless }, 'Launching Chromium...');

        const browser = await chromium.launch({
            headless: this.config.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',   // critical for Docker
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled', // basic stealth
            ],
        });

        browser.on('disconnected', () => {
            log.warn('Chromium disconnected — will relaunch on next request');
            this.browser = null;
        });

        log.info('Chromium launched successfully');
        return browser;
    }

    async isHealthy(): Promise<boolean> {
        return !!this.browser?.isConnected();
    }

    async close(): Promise<void> {
        if (this.browser) {
            log.info('Closing Chromium...');
            await this.browser.close();
            this.browser = null;
        }
    }
}

// Singleton — one pool per process
export const browserPool = new BrowserPool();