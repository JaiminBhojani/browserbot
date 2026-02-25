import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'action:navigate' });

export interface NavigateOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeoutMs?: number;
}

export interface NavigateResult {
    success: boolean;
    url: string;
    title: string;
    error?: string;
}

export async function navigate(
    page: Page,
    url: string,
    options: NavigateOptions = {}
): Promise<NavigateResult> {
    const { waitUntil = 'domcontentloaded', timeoutMs = 30_000 } = options;

    // Ensure URL has a protocol
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;

    log.info({ url: fullUrl }, 'Navigating...');

    try {
        await page.goto(fullUrl, { waitUntil, timeout: timeoutMs });

        const title = await page.title();
        const currentUrl = page.url();

        log.info({ url: currentUrl, title }, 'Navigation complete');
        return { success: true, url: currentUrl, title };
    } catch (err: any) {
        log.error({ url: fullUrl, error: err.message }, 'Navigation failed');
        return { success: false, url: fullUrl, title: '', error: err.message };
    }
}