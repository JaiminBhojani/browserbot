import { BrowserContext, Page } from 'playwright';
import { browserPool } from './browser-pool.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'context-manager' });

export interface UserContext {
    userId: string;
    context: BrowserContext;
    activePage: Page;
    createdAt: number;
    lastActivityAt: number;
}

/**
 * ContextManager — each user gets their own BrowserContext.
 * This means completely isolated: cookies, localStorage, sessions.
 * User A logged into Amazon never bleeds into User B's session.
 */
class ContextManager {
    private contexts = new Map<string, UserContext>();

    /**
     * Get or create an isolated BrowserContext for this user.
     * Idempotent — safe to call on every message.
     */
    async getOrCreate(userId: string): Promise<UserContext> {
        const existing = this.contexts.get(userId);
        if (existing) {
            existing.lastActivityAt = Date.now();
            return existing;
        }

        return this.create(userId);
    }

    private async create(userId: string): Promise<UserContext> {
        log.info({ userId }, 'Creating new browser context');

        const browser = await browserPool.getBrowser();

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            // Each context gets its own isolated storage
            storageState: undefined,
        });

        // Open one default page
        const activePage = await context.newPage();

        // Intercept and block heavy resources to speed up browsing
        await context.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2}', (route) => {
            route.abort();
        });

        const userCtx: UserContext = {
            userId,
            context,
            activePage,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
        };

        this.contexts.set(userId, userCtx);
        log.info({ userId }, 'Browser context ready');

        return userCtx;
    }

    /**
     * Get active page for user — throws if context doesn't exist.
     * Use getOrCreate() for the normal flow.
     */
    getActivePage(userId: string): Page {
        const ctx = this.contexts.get(userId);
        if (!ctx) throw new Error(`No browser context for user: ${userId}`);
        return ctx.activePage;
    }

    /**
     * Update which page is "active" for a user (used by tab manager).
     */
    setActivePage(userId: string, page: Page): void {
        const ctx = this.contexts.get(userId);
        if (!ctx) throw new Error(`No browser context for user: ${userId}`);
        ctx.activePage = page;
        ctx.lastActivityAt = Date.now();
    }

    async destroyContext(userId: string): Promise<void> {
        const ctx = this.contexts.get(userId);
        if (!ctx) return;

        log.info({ userId }, 'Destroying browser context');
        try {
            await ctx.context.close();
        } catch {
            // Ignore errors during close
        }
        this.contexts.delete(userId);
    }

    getAll(): UserContext[] {
        return Array.from(this.contexts.values());
    }

    has(userId: string): boolean {
        return this.contexts.has(userId);
    }

    get size(): number {
        return this.contexts.size;
    }
}

export const contextManager = new ContextManager();