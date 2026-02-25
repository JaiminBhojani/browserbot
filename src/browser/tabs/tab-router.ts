import { Page } from 'playwright';
import { contextManager } from '../pool/context-manager.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'tab-router' });

/**
 * TabRouter — ensures every browser action operates on the
 * correct active page for a given user. Simple but important:
 * without this, actions would always use the first page created,
 * even if the user has switched to a different tab.
 */
export class TabRouter {
    /**
     * Get the currently active page for a user.
     * This is what all browser actions (click, type, navigate, etc.) should use.
     */
    async getActivePage(userId: string): Promise<Page> {
        const ctx = await contextManager.getOrCreate(userId);
        const page = ctx.activePage;

        // Sanity check — page should never be closed
        if (page.isClosed()) {
            log.warn({ userId }, 'Active page was closed, creating new one');
            const newPage = await ctx.context.newPage();
            contextManager.setActivePage(userId, newPage);
            return newPage;
        }

        return page;
    }

    /**
     * Get current page state — useful for the agent to know where it is.
     */
    async getPageState(userId: string): Promise<{
        url: string;
        title: string;
        tabCount: number;
    }> {
        const ctx = await contextManager.getOrCreate(userId);
        const page = ctx.activePage;

        return {
            url: page.url(),
            title: await page.title().catch(() => ''),
            tabCount: ctx.context.pages().length,
        };
    }
}

export const tabRouter = new TabRouter();