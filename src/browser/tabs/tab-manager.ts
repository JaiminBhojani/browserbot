import { Page } from 'playwright';
import { contextManager } from '../pool/context-manager.js';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'tab-manager' });

export interface TabInfo {
    index: number;
    url: string;
    title: string;
    isActive: boolean;
}

/**
 * TabManager — multi-tab support per user.
 * Each user's BrowserContext can have multiple pages (tabs).
 * The "active" tab is what all browser actions operate on.
 */
export class TabManager {
    constructor(private userId: string) { }

    /** Open a new tab and make it active */
    async newTab(url?: string): Promise<TabInfo> {
        const ctx = await contextManager.getOrCreate(this.userId);
        const page = await ctx.context.newPage();

        if (url) {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        }

        contextManager.setActivePage(this.userId, page);
        log.info({ userId: this.userId, url: page.url() }, 'New tab opened');

        return this.pageToInfo(page, true);
    }

    /** Switch to a tab by index (0-based) */
    async switchTab(index: number): Promise<TabInfo> {
        const ctx = await contextManager.getOrCreate(this.userId);
        const pages = ctx.context.pages();

        if (index < 0 || index >= pages.length) {
            throw new Error(`Tab index ${index} out of range (0–${pages.length - 1})`);
        }

        const page = pages[index]!;
        contextManager.setActivePage(this.userId, page);
        await page.bringToFront();

        log.info({ userId: this.userId, index, url: page.url() }, 'Switched to tab');
        return this.pageToInfo(page, true);
    }

    /** Close the current active tab */
    async closeTab(): Promise<void> {
        const ctx = await contextManager.getOrCreate(this.userId);
        const activePage = ctx.activePage;
        const pages = ctx.context.pages();

        if (pages.length <= 1) {
            // Don't close the last tab — just navigate to blank
            await activePage.goto('about:blank');
            log.info({ userId: this.userId }, 'Last tab — navigated to blank instead of closing');
            return;
        }

        await activePage.close();

        // Set the previous tab as active
        const remaining = ctx.context.pages();
        const newActive = remaining[remaining.length - 1]!;
        contextManager.setActivePage(this.userId, newActive);

        log.info({ userId: this.userId, remaining: remaining.length }, 'Tab closed');
    }

    /** List all open tabs for this user */
    async listTabs(): Promise<TabInfo[]> {
        const ctx = await contextManager.getOrCreate(this.userId);
        const pages = ctx.context.pages();
        const activePage = ctx.activePage;

        return Promise.all(
            pages.map((page, index) =>
                this.pageToInfo(page, page === activePage, index)
            )
        );
    }

    private async pageToInfo(page: Page, isActive: boolean, index?: number): Promise<TabInfo> {
        const ctx = await contextManager.getOrCreate(this.userId);
        const pages = ctx.context.pages();
        const actualIndex = index ?? pages.indexOf(page);

        return {
            index: actualIndex,
            url: page.url(),
            title: await page.title().catch(() => ''),
            isActive,
        };
    }
}

/** Factory — get or create a TabManager for a user */
const tabManagers = new Map<string, TabManager>();

export function getTabManager(userId: string): TabManager {
    if (!tabManagers.has(userId)) {
        tabManagers.set(userId, new TabManager(userId));
    }
    return tabManagers.get(userId)!;
}